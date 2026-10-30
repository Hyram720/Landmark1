"""Bearer-token gate for the HTTP transport, so a hosted server only answers paying customers.

Set EXPLAINER_MCP_TOKENS to a comma-separated list of tokens; clients send `Authorization: Bearer <token>`.
"""
import hmac


def require_token(app, tokens: set[str]):
    async def gated(scope, receive, send):
        if scope["type"] == "http":
            auth = dict(scope.get("headers") or []).get(b"authorization", b"").decode()
            given = auth[7:] if auth.lower().startswith("bearer ") else ""
            if not any(hmac.compare_digest(given, t) for t in tokens):
                await send({"type": "http.response.start", "status": 401,
                            "headers": [(b"content-type", b"application/json"), (b"www-authenticate", b"Bearer")]})
                await send({"type": "http.response.body", "body": b'{"error":"missing or invalid token"}'})
                return
        await app(scope, receive, send)
    return gated
