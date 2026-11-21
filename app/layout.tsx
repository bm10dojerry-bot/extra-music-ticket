import type { ReactNode } from "react";
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="vi"><body style={{fontFamily:"Arial,sans-serif",margin:0,background:"#111",color:"#fff"}}>{children}</body></html>; }
