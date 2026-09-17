'use strict';

const sender = require('../../../services/v2/whatsappSender');

const ENV = ['ATTENDANCE_TRANSPORT', 'N8N_ATTENDANCE_WEBHOOK_URL', 'N8N_WEBHOOK_SECRET',
  'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_TEMPLATE_LANG'];

function reply(status, body) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, text: () => Promise.resolve(JSON.stringify(body)) });
}

describe('services/v2/whatsappSender', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    global.fetch = jest.fn();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  it('normalises a number to digits with the country code and masks it for logs', () => {
    expect(sender.normalizeNumber('+91 83178 73609')).toBe('918317873609');
    expect(sender.normalizeNumber('+1 (555) 668-5196')).toBe('15556685196');
    expect(sender.normalizeNumber('12345')).toBe('');
    expect(sender.mask('+91 83178 73609')).toBe('91******3609');
  });

  it('refuses to send without a valid recipient, and never reads one from the environment', async () => {
    process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1243779175483305';
    process.env.WHATSAPP_TEST_TO = '15556685196';
    const r = await sender.send({ text: 'hi' });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/recipient/) });
    expect(global.fetch).not.toHaveBeenCalled();
    delete process.env.WHATSAPP_TEST_TO;
  });

  it('posts to the n8n webhook when one is configured, with the secret header', async () => {
    process.env.N8N_ATTENDANCE_WEBHOOK_URL = 'https://n8n.example/webhook/att';
    process.env.N8N_WEBHOOK_SECRET = 's3';
    process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
    global.fetch.mockReturnValue(reply(200, { id: 'n8n-1' }));

    const r = await sender.send({ to: '+91 83178 73609', text: 'report', payload: { kind: 'attendance_daily', dateKey: '2026-09-17' } });
    expect(r).toEqual({ ok: true, transport: 'n8n', status: 200, id: 'n8n-1' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://n8n.example/webhook/att');
    expect(init.headers['x-webhook-secret']).toBe('s3');
    expect(JSON.parse(init.body)).toEqual({ to: '918317873609', text: 'report', kind: 'attendance_daily', dateKey: '2026-09-17' });
  });

  it('calls the Meta Cloud API directly when only a token is configured', async () => {
    process.env.WHATSAPP_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1243779175483305';
    global.fetch.mockReturnValue(reply(200, { messages: [{ id: 'wamid.1' }] }));

    const r = await sender.send({ to: '918317873609', text: 'report' });
    expect(r).toEqual({ ok: true, transport: 'meta', status: 200, id: 'wamid.1' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v20.0/1243779175483305/messages');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ messaging_product: 'whatsapp', to: '918317873609', type: 'text', text: { preview_url: false, body: 'report' } });
  });

  it('sends a template with body parameters when WHATSAPP_TEMPLATE_NAME is set', async () => {
    process.env.WHATSAPP_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
    process.env.WHATSAPP_TEMPLATE_NAME = 'attendance_daily'; process.env.WHATSAPP_TEMPLATE_LANG = 'en';
    global.fetch.mockReturnValue(reply(200, { messages: [{ id: 'wamid.2' }] }));

    await sender.send({ to: '918317873609', text: 'long body', templateParams: ['Thu, 17 Sep 2026', '12 signed in'] });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.type).toBe('template');
    expect(body.template).toEqual({
      name: 'attendance_daily', language: { code: 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Thu, 17 Sep 2026' }, { type: 'text', text: '12 signed in' }] }],
    });
  });

  it('surfaces the API error message on a rejected send', async () => {
    process.env.WHATSAPP_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
    global.fetch.mockReturnValue(reply(400, { error: { message: '(#131030) Recipient phone number not in allowed list' } }));
    const r = await sender.send({ to: '918317873609', text: 'x' });
    expect(r).toMatchObject({ ok: false, transport: 'meta', status: 400, error: expect.stringMatching(/allowed list/) });
  });

  it('reports a network failure instead of throwing', async () => {
    process.env.WHATSAPP_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
    global.fetch.mockRejectedValue(new Error('ECONNRESET'));
    await expect(sender.send({ to: '918317873609', text: 'x' })).resolves.toMatchObject({ ok: false, error: 'ECONNRESET' });
  });

  it('is a dry run with nothing configured, and says so', async () => {
    const r = await sender.send({ to: '918317873609', text: 'x' });
    expect(r).toEqual({ ok: true, transport: 'log', dryRun: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('honours an explicit transport and reports when it is not configured', () => {
    process.env.ATTENDANCE_TRANSPORT = 'n8n';
    expect(sender.resolveTransport()).toBe('none');
    process.env.N8N_ATTENDANCE_WEBHOOK_URL = 'https://n8n.example/x';
    expect(sender.resolveTransport()).toBe('n8n');
    process.env.ATTENDANCE_TRANSPORT = 'meta';
    expect(sender.resolveTransport()).toBe('none');
  });
});
