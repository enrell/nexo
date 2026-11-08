/**
 * Worker do Encoded Transform (RTCRtpScriptTransform): um só para todas as conexões, para que
 * todas cifrem com o mesmo contador. A lógica está em sframe-transform.ts.
 */
import type { SframeOp } from "./mediakeys";
import { SframeContext, type EncodedFrame, type TransformOptions } from "./sframe-transform";

type Transformer = { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame>; options: TransformOptions };
type Scope = {
  onmessage: ((e: MessageEvent<SframeOp>) => void) | null;
  onrtctransform: ((e: { transformer: Transformer }) => void) | null;
  postMessage: (m: unknown) => void;
};

const scope = self as unknown as Scope;
const ctx = new SframeContext();

scope.onmessage = (e) => void ctx.handle(e.data);
scope.onrtctransform = ({ transformer: t }) => {
  t.readable
    .pipeThrough(ctx.transform(t.options))
    .pipeTo(t.writable)
    .catch(() => {});
};

// contagens (nunca chaves nem conteúdo) para o diagnóstico
let last = "";
setInterval(() => {
  const s = JSON.stringify(ctx.stats);
  if (s !== last) scope.postMessage({ stats: ctx.stats });
  last = s;
}, 5000);
