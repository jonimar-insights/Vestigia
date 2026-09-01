"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: any
      ) => any;
    };
  }
}

export default function YouTube360Test() {
  const containerRef =
    useRef<HTMLDivElement>(null);

  const playerRef =
    useRef<any>(null);

  const [ready, setReady] =
    useState(false);

  const [spherical, setSpherical] =
    useState<any>(null);

  useEffect(() => {
    let destroyed = false;

    const create = () => {
      if (
        destroyed ||
        !containerRef.current ||
        !window.YT?.Player ||
        playerRef.current
      ) {
        return;
      }

      playerRef.current =
        new window.YT.Player(
          containerRef.current,
          {
            videoId: "o0z8Jmf6GKI",

            playerVars: {
              autoplay: 0,
              controls: 1,
              playsinline: 1,
              rel: 0,
              enablejsapi: 1,
              origin: window.location.origin,
            },

            events: {
              onReady: (event: any) => {
                if (destroyed) return;

                setReady(true);

                const iframe =
                  containerRef.current?.querySelector(
                    "iframe"
                  );

                if (iframe) {
                  iframe.setAttribute(
                    "allow",
                    [
                      "autoplay",
                      "encrypted-media",
                      "gyroscope",
                      "accelerometer",
                      "fullscreen",
                      "picture-in-picture",
                      "web-share",
                    ].join("; ")
                  );

                  iframe.setAttribute(
                    "allowfullscreen",
                    ""
                  );
                }

                const props =
                  event.target
                    .getSphericalProperties?.();

                console.log(
                  "YOUTUBE 360 PROPERTIES:",
                  props
                );

                setSpherical(props);
              },

              onStateChange: (
                event: any
              ) => {
                console.log(
                  "YOUTUBE STATE:",
                  event.data
                );

                const props =
                  event.target
                    .getSphericalProperties?.();

                console.log(
                  "SPHERICAL:",
                  props
                );

                setSpherical(props);
              },

              onError: (
                event: any
              ) => {
                console.error(
                  "YOUTUBE ERROR:",
                  event.data
                );
              },
            },
          }
        );
    };

    if (window.YT?.Player) {
      create();
      return;
    }

    const existing =
      document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]'
      );

    if (!existing) {
      const script =
        document.createElement("script");

      script.src =
        "https://www.youtube.com/iframe_api";

      script.async = true;

      document.head.appendChild(
        script
      );
    }

    const interval =
      setInterval(() => {
        if (window.YT?.Player) {
          clearInterval(interval);
          create();
        }
      }, 100);

    return () => {
      destroyed = true;
      clearInterval(interval);

      try {
        playerRef.current?.destroy();
      } catch {}

      playerRef.current = null;
    };
  }, []);

  function rotateRight() {
    const player =
      playerRef.current;

    if (!player) return;

    const current =
      player.getSphericalProperties?.();

    if (!current) return;

    player.setSphericalProperties({
      ...current,
      yaw: (current.yaw ?? 0) + 30,
    });

    setSpherical(
      player.getSphericalProperties?.()
    );
  }

  function rotateLeft() {
    const player =
      playerRef.current;

    if (!player) return;

    const current =
      player.getSphericalProperties?.();

    if (!current) return;

    player.setSphericalProperties({
      ...current,
      yaw: (current.yaw ?? 0) - 30,
    });

    setSpherical(
      player.getSphericalProperties?.()
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-2xl font-bold mb-4">
        YouTube 360 Test
      </h1>

      <div className="relative w-full aspect-video">
        <div
          ref={containerRef}
          className="absolute inset-0"
        />
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={rotateLeft}
          className="px-4 py-2 bg-white text-black rounded"
        >
          ← Rotate
        </button>

        <button
          onClick={rotateRight}
          className="px-4 py-2 bg-white text-black rounded"
        >
          Rotate →
        </button>
      </div>

      <pre className="mt-6 text-xs whitespace-pre-wrap">
        {JSON.stringify(
          {
            ready,
            spherical,
          },
          null,
          2
        )}
      </pre>
    </div>
  );
}