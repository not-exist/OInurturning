import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // host 必须显式绑 IPv4：缺省 'localhost' 在部分机器上只绑 ::1，
    // Playwright/浏览器按 127.0.0.1 探测会被拒绝（此前 e2e webServer 180s 超时的根因）。
    host: '127.0.0.1',
    port: Number(process.env.E2E_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.E2E_API_PORT ?? 3000}` },
  },
});
