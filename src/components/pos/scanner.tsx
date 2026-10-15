"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export function cameraScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Camera barcode scanner using the browser's BarcodeDetector (Chrome on
 * Android, e.g. Honor phones). USB/Bluetooth scanners need none of this: they
 * type into the search box and press Enter.
 */
export function CameraScanner({ onDetect, onClose }: { onDetect: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(() =>
    cameraScanSupported() ? null : "This browser cannot scan with the camera. Use the search box or a barcode scanner.",
  );

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Detector = window.BarcodeDetector;
    if (!Detector) return;
    const detector = new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) {
              navigator.vibrate?.(60);
              onDetect(codes[0].rawValue);
              return;
            }
          } catch {
            // frame not ready
          }
          raf = window.setTimeout(tick, 200) as unknown as number;
        };
        tick();
      } catch {
        setError("Camera permission was refused.");
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetect]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm">Point the camera at a barcode</span>
        <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close scanner">
          <X className="h-5 w-5" />
        </button>
      </div>
      {error ? (
        <p className="m-auto max-w-xs text-center text-sm text-white">{error}</p>
      ) : (
        <div className="relative flex-1">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-x-10 top-1/2 h-32 -translate-y-1/2 rounded-xl border-2 border-white/80" />
        </div>
      )}
    </div>
  );
}
