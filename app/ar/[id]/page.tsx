"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ARPage() {
    const router = useRouter();
    const params = useParams();
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [loadingVideo, setLoadingVideo] = useState(true);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [rotation, setRotation] = useState({ x: 0, y: 0 });
    const [showGuide, setShowGuide] = useState(true);
    const [isPortrait, setIsPortrait] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const cameraRef = useRef<HTMLVideoElement>(null);

    // iOS 13+ Permission Helper
    const requestOrientationPermission = async () => {
        if (
            typeof DeviceOrientationEvent !== 'undefined' &&
            typeof (DeviceOrientationEvent as any).requestPermission === 'function'
        ) {
            try {
                const permissionState = await (DeviceOrientationEvent as any).requestPermission();
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                }
            } catch (e) {
                console.error(e);
            }
        }
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
        if (!event.beta || !event.gamma) return;

        // Clamp tilt for subtle parallax
        const maxTilt = 15;
        const x = Math.min(Math.max((event.beta - 45) * 0.5, -maxTilt), maxTilt);
        const y = Math.min(Math.max(event.gamma * 0.5, -maxTilt), maxTilt);

        setRotation({ x, y });
    };

    const checkOrientation = () => {
        if (typeof window !== "undefined") {
            setIsPortrait(window.matchMedia("(orientation: portrait)").matches);
        }
    };

    useEffect(() => {
        checkOrientation();
        window.addEventListener("resize", checkOrientation);

        // 1. Fetch Video
        const fetchVideo = async () => {
            try {
                const id = params?.id as string;
                if (!id) return;

                const { data, error: dbError } = await supabase
                    .from("talking_codes")
                    .select("video_path, expires_at")
                    .eq("id", id)
                    .single();

                if (dbError) throw dbError;
                if (!data) throw new Error("Video not found");

                if (data.expires_at) {
                    const expires = new Date(data.expires_at);
                    if (new Date() > expires) {
                        throw new Error("Expired");
                    }
                }

                const { data: publicUrlData } = supabase.storage
                    .from("videos")
                    .getPublicUrl(data.video_path);

                setVideoSrc(publicUrlData.publicUrl);
                setLoadingVideo(false);
            } catch (err: any) {
                console.error("Error fetching video:", err);
                setError(err.message === "Expired" ? "Expired" : "Failed to load");
                setLoadingVideo(false);
            }
        };

        fetchVideo();

        // 2. Camera
        const initCamera = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "environment" },
                    audio: false,
                });

                if (cameraRef.current) {
                    cameraRef.current.srcObject = stream;
                    // Hide guide shortly after camera starts
                    setTimeout(() => setShowGuide(false), 2000);
                }
            } catch (err: any) {
                console.error("Camera access error:", err);
                setCameraError("Camera access denied.");
            }
        };

        initCamera();

        // 3. Listeners
        window.addEventListener('deviceorientation', handleOrientation);

        return () => {
            window.removeEventListener("resize", checkOrientation);
            if (cameraRef.current && cameraRef.current.srcObject) {
                const stream = cameraRef.current.srcObject as MediaStream;
                stream.getTracks().forEach(track => track.stop());
            }
            window.removeEventListener('deviceorientation', handleOrientation);
        };
    }, [params]);

    if (cameraError) {
        return (
            <div className="fixed inset-0 bg-black text-white flex items-center justify-center p-4 text-center">
                {cameraError}
            </div>
        );
    }

    if (error === "Expired") {
        return (
            <div className="fixed inset-0 bg-black text-red-500 flex flex-col items-center justify-center p-4 text-center z-50">
                <div className="text-6xl mb-4">👻</div>
                <h1 className="text-2xl font-bold">Signal Lost</h1>
                <p className="opacity-70">This hologram has expired.</p>
                {/* Close Button */}
                <button
                    onClick={() => router.back()}
                    className="mt-8 px-6 py-2 border border-red-500/50 rounded-full hover:bg-red-900/20 text-white"
                >
                    Back
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black overflow-hidden touch-none no-scrollbar font-sans">
            {/* Background Camera */}
            <video
                ref={cameraRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: 1 }}
            />

            {/* Guide Overlay */}
            {showGuide && !error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50 pointer-events-none animate-fade-out">
                    <div className="text-white text-center p-6">
                        <div className="text-4xl mb-4 animate-bounce">📱</div>
                        <h2 className="text-xl font-bold mb-2">Point your phone forward</h2>
                        <p className="text-sm opacity-80">Поднесите телефон</p>
                    </div>
                </div>
            )}

            {/* Landscape Warning */}
            {!isPortrait && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-40 text-white p-6 text-center">
                    <div>
                        <div className="text-4xl mb-4 rotate-90 inline-block">📱</div>
                        <h3 className="text-lg font-bold">Please rotate to portrait</h3>
                        <p className="text-sm text-gray-400">Поверните устройство вертикально</p>
                    </div>
                </div>
            )}

            {/* Close Button */}
            <button
                onClick={() => router.back()}
                className="absolute top-4 right-4 z-50 bg-black/40 backdrop-blur-md text-white/80 p-2 rounded-full hover:bg-black/60 transition-all border border-white/10"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>

            {/* Hologram Overlay (Hidden in Landscape) */}
            {videoSrc && isPortrait && !error && (
                <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    style={{
                        zIndex: 2,
                        perspective: '1000px',
                    }}
                >
                    <div
                        className="relative hologram-container"
                        style={{
                            transformStyle: 'preserve-3d',
                            transform: `rotateX(${-rotation.x}deg) rotateY(${-rotation.y}deg)`,
                            transition: 'transform 0.1s ease-out',
                        }}
                    >
                        {/* Scanline & Effects Overlay */}
                        <div className="absolute inset-0 z-20 scanlines rounded-xl pointer-events-none"></div>

                        {/* Video */}
                        <video
                            ref={videoRef}
                            src={videoSrc}
                            autoPlay
                            playsInline
                            loop
                            muted
                            className="w-auto h-auto max-w-[75vw] max-h-[80vh] object-contain hologram-video"
                        />
                    </div>
                </div>
            )}

            {loadingVideo && !error && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
                    <div className="w-10 h-10 border-4 border-blue-400/50 border-t-blue-400 rounded-full animate-spin"></div>
                </div>
            )}

            <style jsx global>{`
        /* Floating Animation */
        @keyframes hologram-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-15px); }
        }

        /* Fade/Scale In */
        @keyframes hologram-enter {
          0% { opacity: 0; transform: scale(0.9) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0px); }
        }

        /* Moving Scanlines */
        @keyframes scanline-move {
           0% { background-position: 0% 0%; }
           100% { background-position: 0% 100%; }
        }

        /* Fade Out for Guide */
        @keyframes fade-out {
            0% { opacity: 1; }
            80% { opacity: 1; }
            100% { opacity: 0; }
        }

        .animate-fade-out {
            animation: fade-out 2.5s forwards;
        }

        .hologram-container {
             position: relative;
             /* Hologram Entrance */
             animation: hologram-enter 1.2s ease-out forwards;
             /* Blueish Neon Glow around the whole container */
             filter: drop-shadow(0 0 15px rgba(0, 190, 255, 0.4));
        }

        .hologram-video {
          /* Continuous Float */
          animation: hologram-float 5s ease-in-out infinite;
          /* Feather the edges to blend rectangular videos */
          mask-image: radial-gradient(ellipse at center, black 50%, transparent 95%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 50%, transparent 95%);
          
          /* Slight opacity for "ghost" effect */
          opacity: 0.95;
        }

        .scanlines {
            /* Horizontal lines pattern */
            background: linear-gradient(
                to bottom,
                rgba(255, 255, 255, 0),
                rgba(255, 255, 255, 0) 50%,
                rgba(0, 190, 255, 0.1) 50%,
                rgba(0, 190, 255, 0.1)
            );
            background-size: 100% 6px;
            animation: scanline-move 20s linear infinite;
            
            /* Add a subtle overlay gradient */
            box-shadow: inset 0 0 40px rgba(0, 150, 255, 0.2);
            mix-blend-mode: overlay;
        }
      `}</style>
        </div>
    );
}
