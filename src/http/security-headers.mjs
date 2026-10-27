// Reviewed Codex browser annotation stylesheet; keep this exact hash scoped to local previews.
const annotationStyle="'sha256-62lPaUtpvg47KrxPOXYc0Ki8fkE6PNsbY5I9DpyEwZ4='";

export function contentSecurityPolicy({host,publicUrl}={}){
 const localPreview=!publicUrl&&['127.0.0.1','localhost','::1'].includes(host);
 const styles="'self'"+(localPreview?' '+annotationStyle:'');
 return "default-src 'self'; script-src 'self'; style-src "+styles+"; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
}
