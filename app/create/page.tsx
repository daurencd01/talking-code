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
    const [hasUploaded, setHasUploaded] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

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

            recorder.onstop = async () => {
                setIsProcessing(true);
                try {
                    const blob = new Blob(chunksRef.current, { type: "video/webm" });
                    const id = crypto.randomUUID();
                    const fileName = `${id}.webm`;
                    const filePath = `videos/${fileName}`;

                    // Calculate expiration: 24 hours from now
                    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

                    // 1. Upload to Supabase Storage
                    console.log("Uploading to Storage...");
                    const { error: uploadError } = await supabase.storage
                        .from('videos')
                        .upload(filePath, blob);

                    if (uploadError) {
                        throw new Error(`Storage upload failed: ${uploadError.message}`);
                    }

                    // 2. Insert into Database with expires_at
                    console.log("Inserting into Database...");
                    const { error: dbError } = await supabase
                        .from('talking_codes')
                        .insert({
                            id: id,
                            video_path: filePath,
                            expires_at: expiresAt
                        });

                    if (dbError) {
                        // Optional: Cleanup storage if DB insert fails
                        await supabase.storage.from('videos').remove([filePath]);
                        throw new Error(`Database insert failed: ${dbError.message}`);
                    }

                    // 3. Mark session as "uploaded"
                    sessionStorage.setItem("has_uploaded_talking_code", "true");

                    // 4. Redirect on Success
                    router.push(`/view/${id}`);

                } catch (err: any) {
                    console.error("Processing error:", err);
                    alert(`Error: ${err.message || "Unknown error occurred"}`);
                    setIsProcessing(false);
                }
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
                        Record Your Update
                    </h1>
                    <p className="mt-2 text-gray-400">max 15 seconds</p>
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
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                            <span className="text-white text-sm font-medium">
                                Uploading...
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

                <div className="flex justify-center gap-4">
                    {!isRecording ? (
                        <button
                            onClick={startRecording}
                            disabled={isPreparing || isProcessing}
                            className="group relative inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-all duration-200 shadow-lg shadow-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                        >
                            {isPreparing ? "Initializing..." : "Start Recording"}
                            <div className="absolute inset-0 rounded-full ring-2 ring-white/20 group-hover:ring-white/40 transition-all" />
                        </button>
                    ) : (
                        <button
                            onClick={stopRecording}
                            className="group relative inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-red-600 rounded-full hover:bg-red-700 transition-all duration-200 shadow-lg shadow-red-600/30 hover:scale-105 active:scale-95"
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
