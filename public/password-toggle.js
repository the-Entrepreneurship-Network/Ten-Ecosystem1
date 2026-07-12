(function() {
    function initPasswordToggles() {
        document.querySelectorAll('input[type="password"]').forEach(function(input) {
            if (input.dataset.pwToggleInstalled) return;
            input.dataset.pwToggleInstalled = "true";

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'password-toggle-btn';
            btn.style.position = 'absolute';
            btn.style.right = '12px';
            btn.style.top = '50%';
            btn.style.transform = 'translateY(-50%)';
            btn.style.background = 'none';
            btn.style.border = 'none';
            btn.style.outline = 'none';
            btn.style.color = '#94a3b8';
            btn.style.cursor = 'pointer';
            btn.style.padding = '4px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.zIndex = '10';
            btn.style.fontSize = '14px';
            btn.innerHTML = '👁️';

            var parent = input.parentElement;
            if (parent) {
                var computedStyle = window.getComputedStyle(parent);
                if (computedStyle.position === 'static') {
                    parent.style.position = 'relative';
                }
                var currentPaddingRight = parseFloat(window.getComputedStyle(input).paddingRight) || 0;
                if (currentPaddingRight < 36) {
                    input.style.paddingRight = '36px';
                }
                parent.appendChild(btn);
            }

            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (input.type === 'password') {
                    input.type = 'text';
                    btn.innerHTML = '🙈';
                } else {
                    input.type = 'password';
                    btn.innerHTML = '👁️';
                }
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPasswordToggles);
    } else {
        initPasswordToggles();
    }
})();
