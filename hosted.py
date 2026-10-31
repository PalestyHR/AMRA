"""Hosted entry point; shares extraction and evaluation with the local workbench."""
import json
import os
import time
from datetime import datetime, timezone
from http import HTTPStatus
from urllib.parse import urlsplit

import app

API_BASE_URL = os.environ.get('AMRA_API_BASE_URL', 'https://api.deepseek.com').rstrip('/')
DEFAULT_MODEL = os.environ.get('AMRA_MODEL', 'deepseek-flash')
STATIC = app.PUBLIC_FILES


def application(environ, start_response):
    def reply(data, status=200, content_type='application/json; charset=utf-8'):
        body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        headers = [('Content-Type', content_type), ('Content-Length', str(len(body))),
                   ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff'),
                   ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")]
        start_response(f'{status} {HTTPStatus(status).phrase}', headers)
        return [body]

    path = environ.get('PATH_INFO', '/')
    method = environ.get('REQUEST_METHOD', 'GET')
    if method == 'GET':
        if path == '/healthz':
            return reply({'status': 'ok', 'version': app.VERSION})
        if path == '/api/session':
            return reply({'token': app.TOKEN, 'version': app.VERSION, 'rule_version': app.RULE_VERSION,
                          'connection': {'base_url': API_BASE_URL, 'model': DEFAULT_MODEL}})
        if path == '/api/demo':
            return reply(json.loads((app.ROOT / 'demo.json').read_text(encoding='utf-8')))
        if path in STATIC:
            filename, mime = STATIC[path]
            return reply((app.ROOT / filename).read_bytes(), content_type=mime)
        return reply({'error': 'Not found'}, 404)
    if method != 'POST':
        return reply({'error': 'Method not allowed'}, 405)
    if path not in ('/api/analyze', '/api/validate'):
        return reply({'error': 'Not found'}, 404)
    origin = environ.get('HTTP_ORIGIN')
    if origin and urlsplit(origin).netloc.lower() != environ.get('HTTP_HOST', '').lower():
        return reply({'error': 'Open the workbench directly and try again.'}, 403)
    if environ.get('HTTP_X_SESSION_TOKEN') != app.TOKEN:
        return reply({'error': 'Refresh the page and try again.'}, 403)
    try:
        length = int(environ.get('CONTENT_LENGTH') or '0')
        if not 0 < length <= 250000:
            raise ValueError('Request exceeds the size limit.')
        data = json.loads(environ['wsgi.input'].read(length))
        if not isinstance(data, dict):
            raise ValueError('Invalid request format.')
        records = app.parse_records(data.get('text', ''))
        started = time.monotonic()
        requested_model = ''
        if path == '/api/analyze':
            supplied = data.get('config', {})
            if not isinstance(supplied, dict):
                raise ValueError('Invalid model settings.')
            # A visitor cannot use this public endpoint to contact arbitrary URLs.
            config = {'base_url': API_BASE_URL, 'model': supplied.get('model') or DEFAULT_MODEL,
                      'api_key': supplied.get('api_key', '')}
            requested_model = config['model']
            raw, usage, model = app.call_model(config, records)
            mode = 'live_api'
        else:
            raw, usage, model = data.get('raw', ''), {}, 'imported extraction'
            mode = 'import'
        try:
            report = app.evaluate(records, app.decode_output(raw))
        except ValueError as error:
            return reply({'error': str(error), 'raw_output': raw}, 422)
        report.update({'mode': mode, 'model': model, 'requested_model': requested_model,
                       'created_at': datetime.now(timezone.utc).isoformat(),
                       'duration_seconds': round(time.monotonic() - started, 2),
                       'usage': usage, 'rule_version': app.RULE_VERSION, 'prompt': app.PROMPT,
                       'input_records': records, 'raw_output': raw})
        return reply(report)
    except (ValueError, TypeError, AttributeError) as error:
        return reply({'error': str(error)}, 400)
    except Exception:
        return reply({'error': 'Processing failed. Check the input format and retry.'}, 500)


if __name__ == '__main__':
    from waitress import serve
    serve(application, host=os.environ.get('AMRA_BIND', '127.0.0.1'),
          port=int(os.environ.get('AMRA_PORT', '8765')), threads=4,
          max_request_body_size=250000, channel_timeout=180,
          clear_untrusted_proxy_headers=True)
