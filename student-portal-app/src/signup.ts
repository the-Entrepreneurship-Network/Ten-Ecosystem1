/* Every "start" button on this page leads to the same place: the email box in
 * the hero, which IS the sign-up. One helper, so no button can drift off to a
 * page of its own again. */
export function goToSignup(): void {
  document.getElementById('hero')?.scrollIntoView({ behavior: 'smooth' });
  window.setTimeout(() => {
    const box = document.querySelector<HTMLInputElement>('#hero input[type="email"]');
    box?.focus({ preventScroll: true });
  }, 600);
}
