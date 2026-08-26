import AboutSection from './components/AboutSection';
import FeaturedVideoSection from './components/FeaturedVideoSection';
import FeaturesSection from './components/FeaturesSection';
import HeroSection from './components/HeroSection';
import PhilosophySection from './components/PhilosophySection';
import StudentFaceSection from './components/StudentFaceSection';

export default function App() {
  return (
    <main>
      <HeroSection />
      <StudentFaceSection />
      <AboutSection />
      <FeaturedVideoSection />
      <PhilosophySection />
      <FeaturesSection />
      <footer className="border-t border-white/10 bg-black px-6 py-10 text-center text-xs text-white/40">
        © The Entrepreneurship Network ·{' '}
        <a href="/academics.html" className="text-white/70 hover:text-white">Academics</a> ·{' '}
        <a href="/domains" className="text-white/70 hover:text-white">Domains</a> ·{' '}
        <a href="/student-login.html" className="text-white/70 hover:text-white">Login</a>
      </footer>
    </main>
  );
}
