import { NextResponse } from "next/server";

export const maxDuration = 30; // standard limit

export async function POST(req: Request) {
    try {
        const apiKey = process.env.PIXELCUT_API_KEY;
        if (!apiKey) {
            console.error("Missing PIXELCUT_API_KEY");
            return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
        }

        const body = await req.json();
        const { imageUrl } = body;

        if (!imageUrl) {
            return NextResponse.json({ error: "Missing imageUrl" }, { status: 400 });
        }

        console.log("Processing background removal for:", imageUrl);

        // Call Pixelcut API
        const pixelcutResponse = await fetch("https://api.developer.pixelcut.ai/v1/remove-background", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-API-KEY": apiKey
            },
            body: JSON.stringify({
                image_url: imageUrl
            })
        });

        if (!pixelcutResponse.ok) {
            const errorText = await pixelcutResponse.text();
            console.error("Pixelcut API Error:", errorText);
            return NextResponse.json({ error: "Details processing failed" }, { status: pixelcutResponse.status });
        }

        // Pixelcut returns the image binary directly or a JSON with result_url?
        // Checking prompt implication: "Return the processed image result URL or base64".
        // Most BG removal APIs return the image data directly (blob).
        // If Pixelcut returns binary, we need to convert to base64 to send via JSON, 
        // OR return a direct response with correct content type.
        // Returning JSON with base64 is safer for specific client handling.

        // Let's assume binary response based on "remove-background" endpoint name convention
        const imageBlob = await pixelcutResponse.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString("base64");

        return NextResponse.json({
            success: true,
            image: `data:image/png;base64,${base64}`
        });

    } catch (e: any) {
        console.error("API Route Error:", e);
        return NextResponse.json({ error: e.message || "Internal Error" }, { status: 500 });
    }
}
