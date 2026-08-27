import { PORTRAIT_URL } from '../constants';
import { FadeIn } from './FadeIn';
import { Magnet } from './Magnet';

/* The Jack moment: giant condensed heading, magnetic student portrait. */
export default function StudentFaceSection() {
  return (
    <section id="face" className="relative flex min-h-screen flex-col overflow-x-clip bg-black">
      <FadeIn className="relative z-10 mt-16 overflow-hidden md:mt-10" delay={0.1} y={40}>
        <h2 className="face-heading w-full whitespace-nowrap text-center text-[13vw] font-black uppercase leading-none tracking-tight md:text-[15vw]">
          Meet the curious
        </h2>
      </FadeIn>

      <Magnet
        className="absolute left-1/2 z-10 w-[280px] -translate-x-1/2 top-1/2 -translate-y-1/2 sm:top-auto sm:translate-y-0 sm:bottom-0 sm:w-[360px] md:w-[440px] lg:w-[520px]"
        padding={150}
        strength={3}
      >
        <FadeIn delay={0.5} y={30}>
          <img
            src={PORTRAIT_URL}
            alt="TEN student portrait"
            className="h-auto w-full object-contain"
            draggable={false}
          />
        </FadeIn>
      </Magnet>

      {/* The bottom bar — caption plus a "Start your journey" button that led
          away to /domains — is gone: every start on this page is the email
          sign-up in the hero, and the portrait speaks for itself. */}
    </section>
  );
}
