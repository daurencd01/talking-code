import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Talking Code",
    description: "Record your coding thoughts",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="bg-gray-950 text-white antialiased">
                {children}
            </body>
        </html >
    );
}
