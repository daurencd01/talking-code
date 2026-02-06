"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import jsQR from "jsqr";

// Interface for BarcodeDetector (Experimental API)
interface DetectedBarcode {
    boundingBox: DOMRectReadOnly;
    cornerRadius: number;
    format: string;
    rawValue: string;
}

interface BarcodeDetectorOptions {
    formats: string[];
}

declare class BarcodeDetector {
    constructor(options?: BarcodeDetectorOptions);
    static getSupportedFormats(): Promise<string[]>;
    detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

export default function ARPage() {
    const router = useRouter();
    const params = useParams();

    // --- Data State ---
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadingVideo, setLoadingVideo] = useState(true);

    // --- AR State ---
    // null = search mode, Rect = tracking mode
    const [qrAnchor, setQrAnchor] = useState<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>(null);
    const [activated, setActivated] = useState(false);

    const [isPortrait, setIsPortrait] = useState(true);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [permissionGranted, setPermissionGranted] = useState(false);

    // --- Refs ---
    const videoRef = useRef<HTMLVideoElement>(null); // The Hologram
    const cameraRef = useRef<HTMLVideoElement>(null); // The Camera Feed
    const canvasRef = useRef<HTMLCanvasElement>(null); // For jsQR fallback
    const hologramContainerRef = useRef<HTMLDivElement>(null);
    const trackingLoopRef = useRef<number>();
    const isDetectingRef = useRef(false); // Semaphore to prevent async stacking

    // Motion Refs
    const targetRotation = useRef({ x: 0, y: 0 });
    const currentRotation = useRef({ x: 0, y: 0 });

    // Constants
    const LERP_FACTOR = 0.1;
    const ROTATION_FACTOR_X = 0.5; // Multiplier for visual tilt (Gamma)
    const ROTATION_FACTOR_Y = 0.5; // Multiplier for visual tilt (Beta)

    // 1. Device Motion Logic (Fake 3D)
    const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
        if (!event.beta || !event.gamma) return;

        // Normalize tilt centers
        // Beta (X axis tilt): ~45 degrees is "holding phone naturally"
        const x = (event.beta - 45);
        const y = event.gamma;

        targetRotation.current = { x, y };
    }, []);

    // 2. Animation Loop (Visual Updates)
    const renderLoop = useCallback(() => {
        // Lerp Orientation
        const target = targetRotation.current;
        const current = currentRotation.current;

        current.x += (target.x - current.x) * LERP_FACTOR;
        current.y += (target.y - current.y) * LERP_FACTOR;

        // Apply Transform to Hologram Container if it exists
        if (hologramContainerRef.current) {
            // We apply the rotation to simulated depth
            // Note: The positioning (X,Y) is handled by React state (qrAnchor)
            // But we add Micro-Parallax via transform here

            const tiltX = -current.x * ROTATION_FACTOR_X;
            const tiltY = -current.y * ROTATION_FACTOR_Y;

            // Parallax Translations (Subtle shift based on tilt)
            const transX = current.y * 0.5;
            const transY = current.x * 0.5;
            const transZ = 20 + Math.abs(current.x) * 0.2; // Base depth + dynamic

            hologramContainerRef.current.style.transform = `
            translate3d(${transX}px, ${transY}px, ${transZ}px)
            rotateX(${tiltX}deg) 
            rotateY(${tiltY}deg)
        `;
        }

        trackingLoopRef.current = requestAnimationFrame(renderLoop);
    }, []);

    // 3. QR Tracking Loop
    useEffect(() => {
        let trackingInterval: NodeJS.Timeout;

        const detectQR = async () => {
            if (!cameraRef.current || isDetectingRef.current || cameraRef.current.readyState < 2) return;

            isDetectingRef.current = true;

            try {
                // Shared vars for result processing
                let detected: { x: number, y: number, width: number, height: number } | null = null;
                const video = cameraRef.current;
                const { videoWidth, videoHeight, clientWidth, clientHeight } = video;

                // 1. Native BarcodeDetector
                if ("BarcodeDetector" in window) {
                    const barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
                    const barcodes = await barcodeDetector.detect(video);
                    if (barcodes.length > 0) {
                        detected = barcodes[0].boundingBox;
                    }
                }
                // 2. jsQR Fallback (iOS Safari logic)
                else {
                    const canvas = canvasRef.current;
                    if (canvas) {
                        // Match canvas size to video frame for accurate pixel reading
                        if (canvas.width !== videoWidth) canvas.width = videoWidth;
                        if (canvas.height !== videoHeight) canvas.height = videoHeight;

                        const ctx = canvas.getContext("2d", { willReadFrequently: true });
                        if (ctx) {
                            ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
                            const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
                            const code = jsQR(imageData.data, videoWidth, videoHeight);

                            if (code) {
                                // Convert jsQR corners to a bounding box
                                const minX = Math.min(code.location.topLeftCorner.x, code.location.bottomLeftCorner.x);
                                const maxX = Math.max(code.location.topRightCorner.x, code.location.bottomRightCorner.x);
                                const minY = Math.min(code.location.topLeftCorner.y, code.location.topRightCorner.y);
                                const maxY = Math.max(code.location.bottomLeftCorner.y, code.location.bottomRightCorner.y);

                                detected = {
                                    x: minX,
                                    y: minY,
                                    width: maxX - minX,
                                    height: maxY - minY
                                };
                            }
                        }
                    }
                }

                // 3. Unified Coordinate Mapping (Video Space -> Screen Space)
                if (detected && videoWidth && videoHeight) {
                    // Calculate 'object-fit: cover' cropping
                    const videoAspect = videoWidth / videoHeight;
                    const screenAspect = clientWidth / clientHeight;

                    let scale, offsetX, offsetY;

                    if (screenAspect > videoAspect) {
                        // Screen is wider than video (crop top/bottom)
                        scale = clientWidth / videoWidth;
                        offsetX = 0;
                        offsetY = (clientHeight - videoHeight * scale) / 2;
                    } else {
                        // Screen is taller than video (crop sides)
                        scale = clientHeight / videoHeight;
                        offsetX = (clientWidth - videoWidth * scale) / 2;
                        offsetY = 0;
                    }

                    const screenX = detected.x * scale + offsetX;
                    const screenY = detected.y * scale + offsetY;
                    const screenW = detected.width * scale;
                    const screenH = detected.height * scale;

                    setQrAnchor({
                        x: screenX,
                        y: screenY,
                        width: screenW,
                        height: screenH
                    });

                    // Autoplay REMOVED. Activation is manual now.
                } else {
                    // Lost tracking
                    setQrAnchor(null);
                    setActivated(false); // Reset activation state
                    if (videoRef.current) {
                        videoRef.current.pause();
                        videoRef.current.currentTime = 0;
                    }
                }

            } catch (e) {
                console.error("Detection error:", e);
            } finally {
                isDetectingRef.current = false;
            }
        };

        // Run detection ~15-20 times a second is enough for UI updates
        trackingInterval = setInterval(detectQR, 100);

        return () => clearInterval(trackingInterval);
    }, [params]); // Re-init if params change, but largely static

    // 4. Initial Setup
    useEffect(() => {
        // Orientation Listeners
        if (typeof window !== "undefined") {
            setIsPortrait(window.matchMedia("(orientation: portrait)").matches);
            window.addEventListener("resize", () => setIsPortrait(window.matchMedia("(orientation: portrait)").matches));
        }

        // Initialize Video & Camera
        const init = async () => {
            // 1. Fetch Hologram
            const id = params?.id as string;
            if (id) {
                const { data } = await supabase.from("talking_codes").select("*").eq("id", id).single();
                if (data?.video_path) {
                    const { data: urlData } = supabase.storage.from("videos").getPublicUrl(data.video_path);
                    setVideoSrc(urlData.publicUrl);
                    setLoadingVideo(false);
                } else {
                    setError("Not Found");
                    setLoadingVideo(false);
                }
            }

            // 2. Start Camera
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "environment" },
                    audio: false,
                });
                if (cameraRef.current) cameraRef.current.srcObject = stream;
            } catch (e) {
                setCameraError("Camera access denied");
            }
        };

        init();

        // Start Visual Loop
        trackingLoopRef.current = requestAnimationFrame(renderLoop);

        // Permission Dance (iOS)
        if (typeof (DeviceOrientationEvent as any)?.requestPermission !== 'function') {
            window.addEventListener('deviceorientation', handleOrientation);
            setPermissionGranted(true);
        }

        return () => {
            if (trackingLoopRef.current) cancelAnimationFrame(trackingLoopRef.current);
            window.removeEventListener('deviceorientation', handleOrientation);
            if (cameraRef.current?.srcObject) {
                (cameraRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            }
        };
    }, [params, handleOrientation, renderLoop]);

    const requestPermission = async () => {
        if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
            const resp = await (DeviceOrientationEvent as any).requestPermission();
            if (resp === 'granted') {
                setPermissionGranted(true);
                window.addEventListener('deviceorientation', handleOrientation);
            }
        }
    };

    const handleActivate = (e: React.MouseEvent | React.TouchEvent) => {
        e.stopPropagation();
        setActivated(true);
    };

    // Trigger play when activated
    useEffect(() => {
        if (activated && videoRef.current) {
            videoRef.current.play().catch(e => console.log("Play error", e));
        }
    }, [activated]);

    // --- Renders ---

    if (cameraError) {
        return <div className="fixed inset-0 bg-black text-white p-4 flex items-center justify-center">Camera Error</div>;
    }

    // Portrait Enforcement
    if (!isPortrait) {
        return <div className="fixed inset-0 bg-black flex items-center justify-center text-white">Please use Portrait Mode</div>;
    }

    return (
        <div className="fixed inset-0 bg-black overflow-hidden font-sans select-none touch-none" onClick={requestPermission}>

            {/* 1. Camera Feed */}
            <video
                ref={cameraRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: 1 }}
            />

            {/* Hidden Canvas for jsQR Fallback */}
            <canvas ref={canvasRef} className="hidden" />

            {/* 2. UI: Close Button */}
            <button
                onClick={() => router.back()}
                className="absolute top-4 right-4 z-50 bg-black/40 backdrop-blur-md p-2 rounded-full border border-white/20"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" stroke="white" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>

            {/* 3. States Container */}
            <div className="absolute inset-0 z-20 pointer-events-none" style={{ perspective: '1000px' }}>

                {/* SEARCH MODE: Reticle + Prompt */}
                {!qrAnchor && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center animate-fade-in">
                        <div className="w-64 h-64 border-2 border-dashed border-white/50 rounded-xl relative flex items-center justify-center">
                            <div className="absolute inset-0 border-[3px] border-white/80 rounded-xl opacity-20 scale-105 animate-pulse" />
                            <div className="text-white/80 text-center space-y-2">
                                <div className="text-4xl">📷</div>
                                <p className="font-bold tracking-widest text-sm">SCAN QR CODE</p>
                            </div>
                        </div>
                        <p className="mt-8 text-white/70 text-sm bg-black/40 px-4 py-2 rounded-full backdrop-blur-md">
                            Point camera to activate hologram
                        </p>
                    </div>
                )}

                {/* TRACKING MODE: Hologram anchored to QR */}
                {qrAnchor && videoSrc && (
                    <div
                        ref={hologramContainerRef}
                        className="absolute origin-bottom transition-all duration-100 ease-out"
                        style={{
                            // Position exactly at the QR box
                            left: `${qrAnchor.x}px`,
                            top: `${qrAnchor.y}px`,
                            width: `${qrAnchor.width}px`,
                            height: `${qrAnchor.height}px`,
                        }}
                    >
                        {/* 1. ACTIVATED: Show Hologram */}
                        {activated && (
                            <div
                                className="absolute bottom-full left-1/2 -translate-x-1/2 w-[180%] h-[150%] flex flex-col items-center justify-end"
                                style={{ marginBottom: '10px' }}
                            >
                                {/* Materialization Container */}
                                <div className="relative w-full h-full hologram-materialize origin-bottom">

                                    {/* Glow/Scanlines */}
                                    <div className="absolute inset-0 scanlines z-20 rounded-lg opacity-60" />
                                    <div className="absolute inset-0 bg-cyan-500/10 z-10 blur-xl rounded-full opacity-30" />

                                    <video
                                        ref={videoRef}
                                        src={videoSrc}
                                        autoPlay
                                        playsInline
                                        loop
                                        muted
                                        className="w-full h-full object-contain filter drop-shadow-[0_0_15px_rgba(0,190,255,0.5)]"
                                        style={{
                                            maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
                                            WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)'
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* 2. PRE-ACTIVATION: Tap Button */}
                        {!activated && (
                            <div className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 min-w-[150px] flex justify-center">
                                <button
                                    onClick={handleActivate}
                                    className="bg-cyan-500 text-black font-bold py-2 px-6 rounded-full shadow-[0_0_20px_rgba(34,211,238,0.6)] animate-bounce pointer-events-auto"
                                >
                                    TAP TO ACTIVATE
                                </button>
                            </div>
                        )}

                        {/* Tracking Confirmation (The green box around QR) */}
                        <div className="absolute inset-0 border-2 border-cyan-400/50 rounded-lg animate-pulse bg-cyan-400/10 box-confirm" />
                    </div>
                )}
            </div>

            <style jsx global>{`
        @keyframes materialize-pop {
            0% { opacity: 0; transform: translateY(20px) scale(0.8); filter: blur(4px); }
            60% { transform: translateY(-5px) scale(1.05); filter: blur(0px); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes scanline {
            0% { background-position: 0 0; }
            100% { background-position: 0 100%; }
        }
        
        .hologram-materialize {
            animation: materialize-pop 0.5s cubic-bezier(0.3, 1.5, 0.6, 1) forwards;
        }

        .scanlines {
            background: linear-gradient(to bottom, transparent 50%, rgba(34,211,238,0.1) 50%);
            background-size: 100% 4px;
            animation: scanline 6s linear infinite;
        }

        .animate-fade-in {
             animation: fadeIn 0.3s ease-out forwards;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
        </div>
    );
}
