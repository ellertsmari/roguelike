// Dev-only shim to avoid deliberate context loss probes from libraries.
// It wraps getExtension('WEBGL_lose_context') to a no-op object so calling
// loseContext() won’t actually drop the context (and won’t spam the console).
// This does NOT affect genuine driver/context losses.
//
// If you want raw behavior, remove this import in main.ts or guard behind ?debug.

const CanvasProto: any = (globalThis as any).HTMLCanvasElement?.prototype;
if (CanvasProto && !('__codexLoseContextShim' in CanvasProto)) {
  const origGetContext = CanvasProto.getContext;
  CanvasProto.getContext = function patchedGetContext(this: HTMLCanvasElement, type: string, attrs?: any) {
    const ctx: any = origGetContext.call(this, type, attrs);
    if (!ctx) return ctx;
    if (type === 'webgl' || type === 'webgl2') {
      const origGetExtension = ctx.getExtension?.bind(ctx);
      if (origGetExtension) {
        ctx.getExtension = (name: string) => {
          if (name === 'WEBGL_lose_context') {
            // Return a stub with no-op methods
            return { loseContext() {}, restoreContext() {} };
          }
          return origGetExtension(name);
        };
      }

      // Suppress deprecated alpha-premult/y-flip for typed-array uploads by
      // temporarily disabling UNPACK flags on texImage2D/texImage3D when pixels is ArrayBufferView.
      const UNPACK_FLIP_Y_WEBGL = 0x9240;
      const UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
      const origPixelStorei = ctx.pixelStorei?.bind(ctx);
      const origTexImage2D = ctx.texImage2D?.bind(ctx);
      const origTexImage3D = ctx.texImage3D?.bind(ctx);
      // Track last unpack flags
      let lastFlip = false;
      let lastPremult = false;
      if (origPixelStorei) {
        ctx.pixelStorei = (pname: number, param: any) => {
          if (pname === UNPACK_FLIP_Y_WEBGL) lastFlip = !!param;
          if (pname === UNPACK_PREMULTIPLY_ALPHA_WEBGL) lastPremult = !!param;
          return origPixelStorei(pname, param);
        };
      }
      function withUnpackReset<T>(fn: () => T, needsReset: boolean) {
        if (!origPixelStorei || !needsReset) return fn();
        // Temporarily set to false to avoid the browser warning, then restore
        const prevFlip = lastFlip;
        const prevPremult = lastPremult;
        if (prevFlip) origPixelStorei(UNPACK_FLIP_Y_WEBGL, 0);
        if (prevPremult) origPixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        try { return fn(); }
        finally {
          if (prevFlip) origPixelStorei(UNPACK_FLIP_Y_WEBGL, 1);
          if (prevPremult) origPixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        }
      }
      if (origTexImage2D) {
        ctx.texImage2D = function(...args: any[]) {
          const pixels = args[args.length - 1];
          const isTyped = pixels && (ArrayBuffer.isView(pixels));
          return withUnpackReset(() => origTexImage2D(...args), isTyped && (lastFlip || lastPremult));
        };
      }
      if (origTexImage3D) {
        ctx.texImage3D = function(...args: any[]) {
          const pixels = args[args.length - 1];
          const isTyped = pixels && (ArrayBuffer.isView(pixels));
          return withUnpackReset(() => origTexImage3D(...args), isTyped && (lastFlip || lastPremult));
        };
      }

      // Intercept and suppress WebGL warnings at the browser level
      const origConsoleWarn = console.warn;
      const origConsoleError = console.error;
      console.warn = (...args: any[]) => {
        const msg = args.join(' ');
        if (msg.includes('lazy initialization') || msg.includes('incurring lazy initialization')) {
          return; // Suppress this warning
        }
        return origConsoleWarn.apply(console, args);
      };
      console.error = (...args: any[]) => {
        const msg = args.join(' ');
        if (msg.includes('lazy initialization') || msg.includes('incurring lazy initialization')) {
          return; // Suppress this warning
        }
        return origConsoleError.apply(console, args);
      };
    }
    return ctx;
  };
  Object.defineProperty(CanvasProto, '__codexLoseContextShim', { value: true, enumerable: false });
}
