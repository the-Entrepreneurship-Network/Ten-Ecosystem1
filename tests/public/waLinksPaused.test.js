'use strict';

/*
 * public/js/wa-links-paused.js: while the WhatsApp group links are paused, a
 * click on any group link except the General group explains that the admin
 * reset it, instead of opening a dead invite. The General group, and every
 * other link, works as before.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(root, 'public/js/wa-links-paused.js'), 'utf8');
const GENERAL = 'https://chat.whatsapp.com/IN8HO2ZfA23I1iXavgHXw2';

function load({ swal = false, answer = false } = {}) {
    let onClick = null;
    const win = { confirm: jest.fn(() => answer), open: jest.fn() };
    if (swal) win.Swal = { fire: jest.fn() };
    const document = { addEventListener: (type, fn, capture) => { if (type === 'click' && capture) onClick = fn; } };
    vm.runInNewContext(SRC, { document, window: win });
    const click = (href) => {
        const e = { target: { closest: () => (href ? { href } : null) }, preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() };
        onClick(e);
        return e;
    };
    return { win, click };
}

test('a reset group link explains what happened instead of opening', () => {
    const { win, click } = load();
    const e = click('https://chat.whatsapp.com/F2aHmMsa2LF3wbPGKz6tK6?mode=gi_t');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
    expect(win.confirm.mock.calls[0][0]).toMatch(/reset[\s\S]*contact your group admin or coordinator/);
    expect(win.open).not.toHaveBeenCalled();
});

test('the student can go to the General group from the message', () => {
    let { win, click } = load({ answer: true });
    click('https://chat.whatsapp.com/LStta1GmBoVFNuLRNgqZzm');
    expect(win.open).toHaveBeenCalledWith(GENERAL, '_blank', 'noopener');

    ({ win, click } = load({ swal: true }));
    click('https://chat.whatsapp.com/LStta1GmBoVFNuLRNgqZzm');
    expect(win.Swal.fire.mock.calls[0][0].html).toContain(GENERAL);
});

test('the General group and other links work as before', () => {
    const { win, click } = load();
    expect(click(GENERAL).preventDefault).not.toHaveBeenCalled();
    expect(click(null).preventDefault).not.toHaveBeenCalled();
    expect(win.confirm).not.toHaveBeenCalled();
});

test.each(['public/student-dashboard.html', 'public/groups.html', 'public/assistant.html'])('%s loads it', (page) => {
    expect(fs.readFileSync(path.join(root, page), 'utf8')).toContain('<script src="/js/wa-links-paused.js" defer></script>');
});
