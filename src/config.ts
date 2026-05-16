import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-attendance-stamp",
  description:
    "Rotating-QR attendance — host displays a stamp that changes every 30s, attendees scan it",
  accentHex: "#0ea5e9",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
