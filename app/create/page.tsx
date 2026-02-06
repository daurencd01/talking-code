"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CreatePage() {
    const router = useRouter();
    const [isRecording, setIsRecording] = useState(false);
    const [timeLeft, setTimeLeft] = useState(15);
    const [isPreparing, setIsPreparing] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStep, setProcessingStep] = useState<string>("");
    const [hasUploaded, setHasUploaded] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const MAX_DURATION = 15;

    useEffect(() => {
        // Check if user has already uploaded in this session
        if (typeof window !== "undefined") {
            const uploaded = sessionStorage.getItem("has_uploaded_talking_code");
            if (uploaded) {
                setHasUploaded(true);
            }
        }
    }, []);

    // --- Helper: Convert Base64 to Blob ---
    const base64ToBlob = (base64: string): Promise<Blob> => {
        return fetch(base64).then(res => res.blob());
    };

    // --- Helper: Extract Frame from Video Blob ---
    const extractFirstFrame = async (videoBlob: Blob): Promise<Blob | null> => {
        return new Promise((resolve) => {
            const video = document.createElement("video");
            video.preload = "metadata";
            video.muted = true;
            video.playsInline = true;

            const url = URL.createObjectURL(videoBlob);
            video.src = url;

            video.onloadeddata = () => {
                video.currentTime = 0.5; // Capture slightly in to avoid black start frames
            };

            video.onseeked = () => {
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob((blob) => {
                        URL.revokeObjectURL(url);
                        resolve(blob);
                    }, "image/png");
                } else {
                    URL.revokeObjectURL(url);
                    resolve(null);
                }
            };

            video.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(null);
            };
        });
    };

    // --- Shared Upload Logic ---
    const processAndUploadVideo = async (blob: Blob, extension: string = 'webm') => {
        setIsProcessing(true);
        setProcessingStep("Uploading video...");

        try {
            const id = crypto.randomUUID();
            const fileName = `${id}.${extension}`;
            const filePath = `videos/${fileName}`;

            // Calculate expiration: 24 hours from now
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            // 1. Upload Video to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('videos')
                .upload(filePath, blob);

            if (uploadError) {
                throw new Error(`Storage upload failed: ${uploadError.message}`);
            }

            // 2. Background Removal Pipeline
            setProcessingStep("Generating hologram mask...");
            try {
                // a. Extract Frame
                const frameBlob = await extractFirstFrame(blob);
                if (frameBlob) {
                    // b. Upload Frame to get URL
                    const framePath = `videos/${id}_frame.png`;
                    const { error: frameUploadError } = await supabase.storage
                        .from('videos')
                        .upload(framePath, frameBlob);

                    if (!frameUploadError) {
                        const { data: frameUrlData } = supabase.storage
                            .from('videos')
                            .getPublicUrl(framePath);

                        // c. Call Server API
                        const response = await fetch("/api/remove-background", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ imageUrl: frameUrlData.publicUrl })
                        });

                        if (response.ok) {
                            const result = await response.json();
                            if (result.image) {
                                // d. Upload Mask
                                const maskBlob = await base64ToBlob(result.image);
                                const maskPath = `videos/${id}_mask.png`;
                                await supabase.storage
                                    .from('videos')
                                    .upload(maskPath, maskBlob);
                                console.log("Mask uploaded successfully");
                            }
                        } else {
                            console.warn("Background removal failed, skipping mask generation");
                        }
                    }
                }
            } catch (bgError) {
                console.error("Background removal error (non-fatal):", bgError);
                // Continue flow even if BG removal fails
            }

            // 3. Insert into Database
            setProcessingStep("Finalizing...");
            const { error: dbError } = await supabase
                .from('talking_codes')
                .insert({
                    id: id,
                    video_path: filePath,
                    expires_at: expiresAt
                });

            if (dbError) {
                // Cleanup storage if DB insert fails
                await supabase.storage.from('videos').remove([filePath]);
                throw new Error(`Database insert failed: ${dbError.message}`);
            }

            // 4. Mark session and Redirect
            sessionStorage.setItem("has_uploaded_talking_code", "true");
            router.push(`/view/${id}`);

        } catch (err: any) {
            console.error("Processing error:", err);
            alert(`Error: ${err.message || "Unknown error occurred"}`);
            setIsProcessing(false);
        }
    };

    // --- Recording Logic ---
    const startRecording = async () => {
        if (hasUploaded) return;

        try {
            setIsPreparing(true);
            chunksRef.current = [];
            setTimeLeft(MAX_DURATION);

            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.muted = true;
            }

            const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: "video/webm" });
                processAndUploadVideo(blob, 'webm');
            };

            recorder.start();
            setIsRecording(true);
            setIsPreparing(false);

            timerRef.current = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        stopRecording();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

        } catch (err) {
            console.error("Error accessing media devices:", err);
            alert("Could not access camera/microphone. Please ensure permissions are granted.");
            setIsPreparing(false);
        }
    };

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setIsRecording(false);
    }, []);

    // --- Upload Logic ---
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        e.target.value = "";

        const validTypes = ['video/mp4', 'video/webm'];
        if (!validTypes.includes(file.type)) {
            alert('Invalid format. Only MP4 and WebM are allowed.');
            return;
        }

        if (file.size > 30 * 1024 * 1024) {
            alert('File too large. Max 30MB allowed.');
            return;
        }

        const video = document.createElement('video');
        video.preload = 'metadata';

        video.onloadedmetadata = () => {
            window.URL.revokeObjectURL(video.src);
            if (video.duration > 15.5) {
                alert(`Video is too long (${Math.round(video.duration)}s). Max 15 seconds.`);
                return;
            }

            const ext = file.type.includes('mp4') ? 'mp4' : 'webm';
            processAndUploadVideo(file, ext);
        };

        video.onerror = () => {
            window.URL.revokeObjectURL(video.src);
            alert('Failed to load video metadata. The file might be corrupted.');
        };

        video.src = URL.createObjectURL(file);
    };

    const triggerFileUpload = () => {
        fileInputRef.current?.click();
    };

    // --- Cleanup ---
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
    }, []);

    if (hasUploaded) {
        return (
            <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 text-center">
                <h1 className="text-3xl font-bold text-white mb-4">Daily Limit Reached</h1>
                <p className="text-gray-400 mb-8 max-w-md">
                    You have already uploaded a talking code in this session.
                    Please try again later or open a new session.
                </p>
                <button
                    onClick={() => router.push('/')}
                    className="px-6 py-2 bg-gray-800 text-white rounded-full hover:bg-gray-700 transition-colors"
                >
                    Back to Home
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full space-y-8">
                <div className="text-center">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
                        Create Your Code
                    </h1>
                    <p className="mt-2 text-gray-400">Record or upload (max 15s)</p>
                    <p className="text-xs text-blue-400 mt-1">
                        ✨ AI background removal (beta) — use clear lighting
                    </p>
                </div>

                <div className="relative aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-gray-800">
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className={`w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-300 ${isRecording || isPreparing ? 'opacity-100' : 'opacity-50'}`}
                    />

                    {(!isRecording && !isPreparing && !isProcessing) && (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                            <span className="text-sm">Camera preview will appear here</span>
                        </div>
                    )}

                    {isProcessing && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md z-10 transition-all duration-300">
                            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                            <span className="text-white text-lg font-bold animate-pulse">
                                {processingStep || "Processing..."}
                            </span>
                        </div>
                    )}

                    {/* Countdown Overlay */}
                    {isRecording && (
                        <div className="absolute top-4 right-4 bg-red-600/90 text-white px-3 py-1 rounded-full text-sm font-mono animate-pulse shadow-lg backdrop-blur-sm">
                            {timeLeft}s
                        </div>
                    )}
                </div>

                <div className="flex flex-col items-center gap-4">
                    {/* Recording Controls */}
                    {!isRecording ? (
                        <div className="flex flex-col w-full gap-4">
                            <button
                                onClick={startRecording}
                                disabled={isPreparing || isProcessing}
                                className="w-full group relative inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-all duration-200 shadow-lg shadow-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                            >
                                {isPreparing ? "Initializing..." : "Start Recording"}
                                <div className="absolute inset-0 rounded-full ring-2 ring-white/20 group-hover:ring-white/40 transition-all" />
                            </button>

                            <div className="flex items-center gap-2 text-gray-500 text-sm">
                                <div className="h-px bg-gray-800 flex-1" />
                                <span>OR</span>
                                <div className="h-px bg-gray-800 flex-1" />
                            </div>

                            <button
                                onClick={triggerFileUpload}
                                disabled={isProcessing}
                                className="w-full group relative inline-flex items-center justify-center px-8 py-3 text-base font-medium text-gray-300 bg-gray-800 rounded-full hover:bg-gray-700 transition-all duration-200 border border-gray-700 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                📥 Upload Video (mp4/webm)
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="video/mp4,video/webm"
                                className="hidden"
                                onChange={handleFileSelect}
                            />
                        </div>
                    ) : (
                        <button
                            onClick={stopRecording}
                            className="w-full group relative inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-red-600 rounded-full hover:bg-red-700 transition-all duration-200 shadow-lg shadow-red-600/30 hover:scale-105 active:scale-95"
                        >
                            Stop Recording
                            <div className="absolute inset-0 rounded-full ring-2 ring-white/20 group-hover:ring-white/40 transition-all" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
