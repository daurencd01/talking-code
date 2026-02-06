"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ARPage() {
    const router = useRouter();
    const params = useParams();

    // Data State
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadingVideo, setLoadingVideo] = useState(true);

    // App State
    const [isPlaying, setIsPlaying] = useState(false);
    const [isAnchorLost, setIsAnchorLost] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [isPortrait, setIsPortrait] = useState(true);
    const [permissionGranted, setPermissionGranted] = useState(false);

    // Refs for Animation & DOM
    const videoRef = useRef<HTMLVideoElement>(null);
    const cameraRef = useRef<HTMLVideoElement>(null);
    const hologramRef = useRef<HTMLDivElement>(null);

    // Motion Refs (for smooth lerping without re-renders)
    const targetRotation = useRef({ x: 0, y: 0 });
    const currentRotation = useRef({ x: 0, y: 0 });
    const requestRef = useRef<number>();

    // --- Constants ---
    const MAX_TILT = 45; // Degrees before "loss"
    const LERP_FACTOR = 0.12; // Adjusted for slightly more responsiveness with inertia

    // 1. Orientation & Animation Loop
    const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
        if (!event.beta || !event.gamma) return;

        // Beta: Front/Back tilt (-180 to 180). 
        // We treat ~45 degrees (holding phone naturally) as "0" center.
        // Gamma: Left/Right tilt (-90 to 90).
        // Invert X/Y logic for natural "looking around" feel
        const x = (event.beta - 45);
        const y = event.gamma;

        targetRotation.current = { x, y };
    }, []);

    const animate = useCallback(() => {
        // Lerp logic: current = current + (target - current) * factor
        const target = targetRotation.current;
        const current = currentRotation.current;

        current.x += (target.x - current.x) * LERP_FACTOR;
        current.y += (target.y - current.y) * LERP_FACTOR;

        // Check Anchor Loss
        const isLost = Math.abs(current.x) > MAX_TILT || Math.abs(current.y) > MAX_TILT;

        // Only trigger state update if changed (prevent render thrashing)
        setIsAnchorLost((prev) => (prev !== isLost ? isLost : prev));

        // Apply Transform directly to DOM for performance
        if (hologramRef.current && !isLost) {
            // ENHANCED PARALLAX: Combine Rotation with Translation
            // translateX: Shift horizontally based on Gamma (Y tilt)
            // translateY: Shift vertically based on Beta (X tilt)
            // translateZ: Push deeper/closer based on tilt amount to simulate depth change

            const transX = current.y * 0.8; // Move X based on Y tilt
            const transY = current.x * 0.5; // Move Y based on X tilt
            const transZ = 40 + Math.abs(current.x) * 0.4; // Depth boost on tilt

            hologramRef.current.style.transform = `
        translateX(${transX}px)
        translateY(${transY}px)
        translateZ(${transZ}px)
        rotateX(${-current.x}deg) 
        rotateY(${-current.y}deg) 
      `;
        }

        requestRef.current = requestAnimationFrame(animate);
    }, []);

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [animate]);

    // 2. Setup & Data Fetching
    useEffect(() => {
        if (typeof window !== "undefined") {
            setIsPortrait(window.matchMedia("(orientation: portrait)").matches);
            window.addEventListener("resize", () => {
                setIsPortrait(window.matchMedia("(orientation: portrait)").matches);
            });
        }

        const init = async () => {
            // Fetch Video
            try {
                const id = params?.id as string;
                if (!id) return;

                const { data, error: dbError } = await supabase
                    .from("talking_codes")
                    .select("video_path, expires_at")
                    .eq("id", id)
                    .single();

                if (dbError || !data) throw new Error("Video not found");

                if (data.expires_at && new Date() > new Date(data.expires_at)) {
                    throw new Error("Expired");
                }

                const { data: publicUrlData } = supabase.storage
                    .from("videos")
                    .getPublicUrl(data.video_path);

                setVideoSrc(publicUrlData.publicUrl);
                setLoadingVideo(false);
            } catch (err: any) {
                console.error(err);
                setError(err.message === "Expired" ? "Expired" : "Failed to load");
                setLoadingVideo(false);
            }

            // Camera
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "environment" },
                    audio: false,
                });
                if (cameraRef.current) cameraRef.current.srcObject = stream;
            } catch (e) {
                setCameraError("permission_denied");
            }
        };

        init();

        // Permissions for iOS 13+ motion
        if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
            // Wait for user interaction
        } else {
            window.addEventListener('deviceorientation', handleOrientation);
            setPermissionGranted(true); // Android/Desktop usually grants implicitly or via browser prompt
        }

        return () => {
            window.removeEventListener('deviceorientation', handleOrientation);
            if (cameraRef.current?.srcObject) {
                (cameraRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            }
        };
    }, [params, handleOrientation]);

    // 3. Handlers
    const handlePlay = async () => {
        if (
            typeof (DeviceOrientationEvent as any)?.requestPermission === 'function' &&
            !permissionGranted
        ) {
            try {
                const resp = await (DeviceOrientationEvent as any).requestPermission();
                if (resp === 'granted') {
                    setPermissionGranted(true);
                    window.addEventListener('deviceorientation', handleOrientation);
                }
            } catch (e) {
                console.error(e);
            }
        }

        setIsPlaying(true);
        setTimeout(() => {
            videoRef.current?.play().catch(() => console.log("Autoplay blocked"));
        }, 100);
    };

    const handleClose = () => {
        if (isPlaying) {
            setIsPlaying(false);
            // Pause video
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.currentTime = 0;
            }
        } else {
            router.back();
        }
    };

    // --- Renders ---

    if (cameraError) {
        return (
            <div className="fixed inset-0 bg-black text-white flex items-center justify-center p-4 text-center">
                <p>Camera access is required for AR.</p>
            </div>
        );
    }

    if (error === "Expired") {
        return (
            <div className="fixed inset-0 bg-black text-red-500 flex flex-col items-center justify-center p-4 text-center z-50">
                <div className="text-6xl mb-4">👻</div>
                <h1 className="text-2xl font-bold">Signal Lost</h1>
                <p className="opacity-70">This hologram has expired.</p>
                <button onClick={() => router.back()} className="mt-8 px-6 py-2 border border-red-500/50 rounded-full text-white">Back</button>
            </div>
        );
    }

    // Landscape Handler
    if (!isPortrait) {
        return <div className="fixed inset-0 bg-black flex items-center justify-center text-white">Please rotate to portrait</div>;
    }

    return (
        <div className="fixed inset-0 bg-black overflow-hidden font-sans select-none touch-none">

            {/* 1. Camera Feed */}
            <video
                ref={cameraRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: 1, opacity: 1 }}
            />

            {/* 2. UI Layer (Top) */}
            <div className="absolute inset-0 z-50 pointer-events-none flex flex-col justify-between p-6">
                {/* Top Bar */}
                <div className="flex justify-end pointer-events-auto">
                    <button
                        onClick={handleClose}
                        className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 active:scale-95 transition-transform hover:bg-black/60"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>

            {/* 3. Center AR Anchor Context */}
            <div
                className="absolute inset-0 z-10 flex items-center justify-center"
                style={{ perspective: '1000px' }}
            >

                {/* RETICLE (The "Anchor Point") */}
                <div
                    className={`relative w-64 h-64 transition-all duration-700 ease-out will-change-transform ${isPlaying
                            ? 'opacity-[0.15] scale-100 blur-[2px]'
                            : 'opacity-100 animate-pulse-anchor shadow-[0_0_50px_rgba(0,190,255,0.15)]'
                        }`}
                >
                    {/* Corners - Living Anchor look */}
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-cyan-400 rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-cyan-400 rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-cyan-400 rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-cyan-400 rounded-br-lg" />

                    {/* Guide Text */}
                    {!isPlaying && (
                        <div className="absolute -bottom-16 left-0 right-0 text-center space-y-2">
                            <p className="text-cyan-400 font-bold tracking-[0.2em] text-sm animate-pulse">ALIGN QR CODE</p>
                            <p className="text-white/60 text-xs tracking-wider">Tap play to activate</p>
                        </div>
                    )}

                    {/* Play Button (Inside Reticle) */}
                    {!isPlaying && !loadingVideo && !error && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <button
                                onClick={handlePlay}
                                className="group pointer-events-auto relative w-20 h-20 flex items-center justify-center"
                            >
                                <div className="absolute inset-0 bg-cyan-400/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500" />
                                <div className="relative w-16 h-16 bg-black/40 backdrop-blur-md border border-cyan-400/50 rounded-full flex items-center justify-center group-active:scale-90 transition-transform shadow-[0_0_20px_rgba(0,255,255,0.2)]">
                                    <svg className="w-8 h-8 text-cyan-50 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                {/* HOLOGRAM CONTAINER (Anchored above Center) */}
                {isPlaying && videoSrc && !isAnchorLost && (
                    <div
                        ref={hologramRef}
                        className="absolute w-[75vw] h-[65vh] pointer-events-none origin-bottom hologram-materialize"
                        style={{
                            bottom: '50%', // Starts from center
                            marginBottom: '100px', // Pushes up to sit on top of QR
                            transformStyle: 'preserve-3d',
                        }}
                    >
                        {/* Floating Wrapper (Independent of Tilt) */}
                        <div className="w-full h-full relative animate-hologram-float">

                            {/* Visual Effects */}
                            <div className="absolute inset-0 scanlines opacity-60 z-20 rounded-lg pointer-events-none" />
                            <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/10 to-transparent opacity-20 z-10 rounded-lg pointer-events-none" />

                            {/* The Video Info */}
                            <video
                                ref={videoRef}
                                src={videoSrc}
                                playsInline
                                loop
                                muted
                                className="w-full h-full object-contain drop-shadow-[0_0_25px_rgba(0,190,255,0.3)]"
                                style={{
                                    maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
                                    WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* ANCHOR LOST MESSAGE */}
                {isAnchorLost && isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50 backdrop-blur-md transition-all duration-300">
                        <div className="text-center p-8 border border-red-500/30 bg-black/80 rounded-2xl shadow-[0_0_30px_rgba(255,0,0,0.1)]">
                            <p className="text-4xl mb-3 animate-bounce">⚠️</p>
                            <p className="text-red-400 font-bold tracking-widest text-lg">ALIGN QR CODE</p>
                            <p className="text-white/50 text-sm mt-2">Signal interference detected</p>
                        </div>
                    </div>
                )}

            </div>

            <style jsx global>{`
        @keyframes materialize-pop {
            0% {
                opacity: 0;
                transform: translateY(30px) scale(0.9) translateZ(-50px);
                filter: blur(10px);
            }
            70% {
                opacity: 1;
                transform: translateY(-5px) scale(1.02) translateZ(10px); /* Overshoot */
                filter: blur(0px);
            }
            100% {
                transform: translateY(0) scale(1) translateZ(0); /* Settle */
            }
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-12px); }
        }

        @keyframes scanline {
            0% { background-position: 0 0; }
            100% { background-position: 0 100%; }
        }
        
        @keyframes anchor-pulse {
            0%, 100% { 
                transform: scale(1);
                box-shadow: 0 0 20px rgba(0,190,255,0.1);
                border-color: rgba(34,211,238,0.6); 
            }
            50% { 
                transform: scale(1.03);
                box-shadow: 0 0 35px rgba(0,190,255,0.25);
                border-color: rgba(34,211,238,1);
            }
        }

        .hologram-materialize {
            animation: materialize-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .animate-hologram-float {
            animation: float 5s ease-in-out infinite;
        }

        .animate-pulse-anchor {
            animation: anchor-pulse 2.5s ease-in-out infinite;
        }

        .scanlines {
            background: linear-gradient(
                to bottom,
                rgba(255,255,255,0) 50%,
                rgba(34,211,238,0.08) 50%
            );
            background-size: 100% 3px;
            animation: scanline 8s linear infinite;
        }
      `}</style>
        </div>
    );
}
