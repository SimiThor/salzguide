"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

// Avatar für den KI-Local „Toni". Das Bild wird im Admin (Einstellungen) gesetzt und
// in app_settings gespeichert (öffentlich lesbar). Hier client-seitig geladen und
// pro Seiten-Load gecacht (der Avatar-Header ist dauerhaft gemountet). Ist keins
// gesetzt, zeigt es den Platzhalter: Brandfarbe (accent) + 👨🏼‍🦳.
let cachedUrl: string | null | undefined = undefined; // undefined = noch nicht geladen

export default function ToniAvatar({ size = 40 }: { size?: number }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size };

  useEffect(() => {
    let cancelled = false;
    const apply = (v: string | null) => {
      if (!cancelled) setUrl(v);
    };
    if (cachedUrl !== undefined) {
      const v = cachedUrl;
      void Promise.resolve().then(() => apply(v));
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      let v: string | null = null;
      try {
        const { data } = await createClient()
          .from("app_settings")
          .select("value")
          .eq("key", "toni_avatar_url")
          .maybeSingle();
        v = ((data?.value as string | null) ?? null) || null;
      } catch {
        v = null;
      }
      cachedUrl = v;
      apply(v);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showImg = Boolean(url) && !failed;
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full ring-1 ring-black/10"
      style={dim}
      aria-hidden
    >
      {showImg ? (
        // next/image statt <img>: Der Avatar wird als 512px-Quadrat hochgeladen
        // (AVATAR_DIM in image-upload.ts), angezeigt wird er mit 40px. Als rohes <img>
        // lud jeder Seitenaufruf die vollen 512px aus dem Storage. quality 50, weil man
        // bei 40px Kantenlänge keinen Unterschied sieht.
        <Image
          src={url as string}
          alt=""
          width={size}
          height={size}
          sizes={`${size}px`}
          quality={50}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-accent text-[18px]">
          👨🏼‍🦳
        </div>
      )}
    </div>
  );
}
