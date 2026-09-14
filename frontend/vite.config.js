import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// لا يوجد proxy بعد الآن — الواجهة تتصل مباشرة بمشروع Supabase
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
