/*
 * Temporary: WhatsApp group links are paused, except the General group.
 *
 * Group admins have reset the invite links, so the old links on these pages no
 * longer work. Until they are replaced, a click on any WhatsApp group link other
 * than the General group says so and sends the student to their group admin.
 * Remove this file and its <script> tags once the links are updated.
 */
(function () {
    var GENERAL = 'IN8HO2ZfA23I1iXavgHXw2';
    var GENERAL_URL = 'https://chat.whatsapp.com/' + GENERAL;
    var TITLE = 'This WhatsApp group link was reset';
    var TEXT = 'The group admin has reset this WhatsApp group link, so it no longer works. ' +
        'Please contact your group admin or coordinator, and join the group through them.';

    document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a[href*="chat.whatsapp.com/"]') : null;
        if (!a || a.href.indexOf(GENERAL) !== -1) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (window.Swal && window.Swal.fire) {
            window.Swal.fire({
                icon: 'info',
                title: TITLE,
                html: TEXT + '<br><br>Meanwhile, you can join the <a href="' + GENERAL_URL +
                    '" target="_blank" rel="noopener noreferrer">General group</a>.'
            });
        } else if (window.confirm(TITLE + '\n\n' + TEXT + '\n\nOpen the General group now?')) {
            window.open(GENERAL_URL, '_blank', 'noopener');
        }
    }, true);
})();
