import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#1f5c45", color: "#f5f2ea", fontSize: 300, fontFamily: "serif", fontWeight: 700 }}>
        B
      </div>
    ),
    size,
  );
}
