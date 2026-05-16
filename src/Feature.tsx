import { useEffect, useState } from "react";
import {
  PersonalQR,
  useQRScanner,
  parseScanPayload,
  makeScanPayload,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };
type StampLog = { peerId: string; name: string; slot: number; ts: number };

const NAME_KEY = (p: string) => `${p}:displayName`;
const HOST_KEY = (p: string) => `${p}:isHost`;
const SLOT_SEC = 30;

function currentSlot() {
  return Math.floor(Date.now() / 1000 / SLOT_SEC);
}

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="viral-screen">
        <h1>attendance stamp</h1>
        <p className="viral-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [isHost, setIsHost] = useState(
    () => localStorage.getItem(HOST_KEY(config.storagePrefix)) === "1",
  );
  const [showScanner, setShowScanner] = useState(false);
  const [slot, setSlot] = useState(() => currentSlot());
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useState(0);

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);
  useEffect(() => {
    localStorage.setItem(HOST_KEY(config.storagePrefix), isHost ? "1" : "0");
  }, [isHost, config.storagePrefix]);

  useEffect(() => {
    const log = room.doc.getArray<StampLog>("log");
    const cb = () => rerender((n) => n + 1);
    log.observe(cb);
    return () => log.unobserve(cb);
  }, [room]);

  useEffect(() => {
    const id = setInterval(() => setSlot(currentSlot()), 1000);
    return () => clearInterval(id);
  }, []);

  const log = room.doc.getArray<StampLog>("log");

  const hostStampPayload = makeScanPayload(room.roomId, "STAMP", `${slot}`);

  const myPayload = makeScanPayload(room.roomId, room.peerId, name.trim() || "anon");

  const scanner = useQRScanner({
    onScan: (r) => {
      const parsed = parseScanPayload(r.text);
      if (!parsed) return;
      if (parsed.peerId !== "STAMP") {
        setError("not a host stamp QR");
        return;
      }
      const claimedSlot = parseInt(parsed.extra ?? "", 10);
      const now = currentSlot();
      if (!Number.isFinite(claimedSlot) || Math.abs(now - claimedSlot) > 1) {
        setError("stamp expired — try again");
        return;
      }
      setError(null);
      // Idempotent: don't insert duplicate stamps for same slot+peer
      const existing = log
        .toArray()
        .some((e) => e.peerId === room.peerId && e.slot === claimedSlot);
      if (existing) return;
      log.push([
        { peerId: room.peerId, name: name.trim() || "anon", slot: claimedSlot, ts: Date.now() },
      ]);
      scanner.stop();
      setShowScanner(false);
    },
  });

  const myStamps = log.toArray().filter((e) => e.peerId === room.peerId);
  const allByPeer = new Map<string, Array<StampLog>>();
  log.toArray().forEach((e) => {
    const list = allByPeer.get(e.peerId) ?? [];
    list.push(e);
    allByPeer.set(e.peerId, list);
  });

  return (
    <div className="viral-screen">
      <header>
        <h1>attendance stamp</h1>
        <p className="viral-status">
          slot {slot} · {log.length} stamps total · {room.peerCount + 1} present
        </p>
      </header>

      <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
        <input type="checkbox" checked={isHost} onChange={(e) => setIsHost(e.target.checked)} />i am
        the host (show rotating stamp QR)
      </label>

      <input
        className="viral-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="your name"
        maxLength={48}
      />

      {isHost ? (
        <section>
          <h2 className="viral-section-title">today's stamp (rotates every {SLOT_SEC}s)</h2>
          <div className="mesh-qrx-qr" style={{ maxWidth: "16rem" }}>
            <PersonalQR payload={hostStampPayload} size={220} />
          </div>
          <p className="viral-status">
            stamp #{slot} · rotates at {SLOT_SEC - (Math.floor(Date.now() / 1000) % SLOT_SEC)}s
          </p>
        </section>
      ) : (
        <section>
          <h2 className="viral-section-title">scan the host's stamp to mark yourself present</h2>
          <button
            type="button"
            className="viral-primary"
            disabled={!name.trim()}
            onClick={() => {
              if (showScanner) {
                scanner.stop();
                setShowScanner(false);
              } else {
                setShowScanner(true);
                void scanner.start();
              }
            }}
          >
            {showScanner ? "✗ stop scanner" : "📷 scan stamp"}
          </button>
          {showScanner && (
            <video
              ref={scanner.videoRef}
              muted
              playsInline
              autoPlay
              className="mesh-qrx-video"
              style={{ marginTop: "0.5rem" }}
            />
          )}
          {error && <p className="mesh-qrx-error">{error}</p>}
          <details style={{ marginTop: "0.5rem" }}>
            <summary>paste a stamp payload</summary>
            <PasteForm
              onSubmit={(text) => {
                scanner.stop();
                // mimic the onScan handler
                const r = { text, ts: Date.now() };
                scanner as unknown as { _scanForTests?: (r: { text: string; ts: number }) => void };
                // Trigger handler directly via scanner-internal callback path:
                const parsed = parseScanPayload(text);
                if (!parsed || parsed.peerId !== "STAMP") {
                  setError("not a stamp QR");
                  return;
                }
                const claimedSlot = parseInt(parsed.extra ?? "", 10);
                const now = currentSlot();
                if (!Number.isFinite(claimedSlot) || Math.abs(now - claimedSlot) > 1) {
                  setError("stamp expired");
                  return;
                }
                const existing = log
                  .toArray()
                  .some((e) => e.peerId === room.peerId && e.slot === claimedSlot);
                if (!existing) {
                  log.push([
                    {
                      peerId: room.peerId,
                      name: name.trim() || "anon",
                      slot: claimedSlot,
                      ts: Date.now(),
                    },
                  ]);
                }
                setError(null);
                void r;
              }}
            />
          </details>
        </section>
      )}

      <section>
        <h2 className="viral-section-title">your stamps ({myStamps.length})</h2>
        {myStamps.length === 0 ? (
          <p className="viral-empty">scan a stamp to start collecting</p>
        ) : (
          <ul className="as-stamps">
            {myStamps.map((s, i) => (
              <li key={i}>
                ✓ slot #{s.slot} · {new Date(s.ts).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="viral-section-title">all attendees</h2>
        {allByPeer.size === 0 ? (
          <p className="viral-empty">none yet</p>
        ) : (
          <ul className="as-attendees">
            {Array.from(allByPeer.entries()).map(([peerId, stamps]) => (
              <li key={peerId} className={peerId === room.peerId ? "is-me" : ""}>
                <strong>{stamps[0]?.name ?? peerId.slice(0, 6)}</strong>
                <span>{stamps.length} stamps</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* show my own QR for completeness */}
      <details style={{ marginTop: "0.6rem" }}>
        <summary className="viral-section-title">my personal QR</summary>
        <PersonalQR payload={myPayload} size={160} />
      </details>
    </div>
  );
}

function PasteForm({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v.trim());
        setV("");
      }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="paste mesh://room/STAMP#slot payload"
        aria-label="paste stamp"
        className="viral-name"
      />
      <button type="submit" className="viral-ghost" disabled={!v.trim()}>
        claim
      </button>
    </form>
  );
}
