"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { QRCodeCanvas } from "qrcode.react";

export default function ViewPage() {
    const params = useParams();
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [arUrl, setArUrl] = useState<string>("");
    const qrRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Construct AR URL when window is available
        if (typeof window !== "undefined" && params?.id) {
            setArUrl(`${window.location.origin}/ar/${params.id}`);
        }

        const fetchVideo = async () => {
            try {
                const id = params?.id as string;
                if (!id) return;

                // 1. Get record from DB
                const { data, error: dbError } = await supabase
                    .from('talking_codes')
                    .select('video_path, expires_at')
                    .eq('id', id)
                    .single();

                if (dbError) throw dbError;
                if (!data) throw new Error("Video not found");

                // Check expiration
                if (data.expires_at) {
                    const expires = new Date(data.expires_at);
                    if (new Date() > expires) {
                        throw new Error("This talking code has expired.");
                    }
                }

                // 2. Get public URL from Storage
                const { data: publicUrlData } = supabase.storage
                    .from('videos')
                    .getPublicUrl(data.video_path);

                setVideoSrc(publicUrlData.publicUrl);
            } catch (err: any) {
                console.error("Error fetching video:", err);
                setError(err.message || "Failed to load video");
            } finally {
                setLoading(false);
            }
        };

        fetchVideo();
    }, [params]);

    const downloadQRCode = () => {
        const canvas = qrRef.current?.querySelector("canvas");
        if (canvas) {
            const url = canvas.toDataURL("image/png");
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `qrcode-${params?.id}.png`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-400">Loading video...</p>
                </div>
            </div>
        );
    }

    if (error || !videoSrc) {
        return (
            <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white p-4">
                <div className="text-center max-w-md">
                    <div className="text-6xl mb-6">👻</div>
                    <h1 className="text-2xl font-bold mb-4 text-red-500">Video Expired or Not Found</h1>
                    <p className="mb-8 text-gray-400">
                        {error || "This message has self-destructed or does not exist."}
                    </p>
                    <Link
                        href="/create"
                        className="px-8 py-3 bg-blue-600 rounded-full hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/30 font-medium"
                    >
                        Record New Video
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full space-y-8">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-white mb-2">Your Recording</h1>
                    <p className="text-sm text-gray-500 font-mono">{params?.id}</p>
                </div>

                <div className="relative aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-gray-800">
                    <video
                        src={videoSrc}
                        controls
                        autoPlay
                        className="w-full h-full object-cover"
                    />
                </div>

                <div className="flex flex-col items-center gap-6 bg-gray-900 p-6 rounded-2xl border border-gray-800">
                    <div className="text-center">
                        <h3 className="text-white font-medium mb-4">Scan to View in AR</h3>
                        <div ref={qrRef} className="bg-white p-2 rounded-lg inline-block">
                            {arUrl && (
                                <QRCodeCanvas
                                    value={arUrl}
                                    size={150}
                                    level={"H"}
                                    includeMargin={true}
                                />
                            )}
                        </div>
                    </div>

                    <button
                        onClick={downloadQRCode}
                        className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M12 12.75l-3-3m0 0 3-3m-3 3h7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" />
                        </svg>
                        Download QR Code
                    </button>
                </div>

                <div className="flex justify-center gap-4">
                    <Link
                        href="/create"
                        className="px-6 py-2 bg-gray-800 text-white rounded-full hover:bg-gray-700 transition-colors border border-gray-700"
                    >
                        Record Another
                    </Link>
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(arUrl || window.location.href);
                            alert("AR Link copied to clipboard!");
                        }}
                        className="px-6 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
                    >
                        Copy AR Link
                    </button>
                </div>
            </div>
        </div>
    );
}
