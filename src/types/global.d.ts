declare module "hls.js" {
  interface Hls {
    static isSupported(): boolean;
    loadSource(src: string): void;
    attachMedia(video: HTMLVideoElement): void;
    on(event: string, handler: (...args: any[]) => void): void;
    destroy(): void;
  }

  interface HlsConstructor {
    new (config?: any): Hls;
    isSupported(): boolean;
    Events: {
      MANIFEST_PARSED: string;
      ERROR: string;
    };
  }

  const Hls: HlsConstructor;
  export default Hls;
}
