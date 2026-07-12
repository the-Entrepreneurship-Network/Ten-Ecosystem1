import React from 'react';
import { Briefcase, GraduationCap, Users, UserPlus, ArrowRight, Sparkles } from 'lucide-react';

export function RoleConstellation() {
  return (
    <div className="min-h-screen bg-[#0a0810] text-white flex flex-col font-sans overflow-hidden">
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes float {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
          100% { transform: translateY(0px); }
        }
        @keyframes pulse-glow {
          0% { box-shadow: 0 0 0 0 rgba(212, 175, 55, 0.4); }
          70% { box-shadow: 0 0 0 15px rgba(212, 175, 55, 0); }
          100% { box-shadow: 0 0 0 0 rgba(212, 175, 55, 0); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        .animate-pulse-glow {
          animation: pulse-glow 3s infinite;
        }
        .glass-panel {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .bg-radial-gradient {
          background: radial-gradient(circle at center, rgba(212, 175, 55, 0.15) 0%, transparent 70%);
        }
      `}} />

      {/* Decorative background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-radial-gradient pointer-events-none opacity-50 mix-blend-screen rounded-full blur-[100px]"></div>

      {/* Header */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-8 flex flex-col items-center text-center space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#D4AF37] to-[#B8860B] flex items-center justify-center shadow-lg shadow-[#D4AF37]/20">
            <span className="font-bold text-[#0a0810] text-xl tracking-tighter">TEN</span>
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-bold tracking-tight text-white leading-none">The Entrepreneurship Network</h1>
            <p className="text-[#D4AF37] text-sm font-medium tracking-wide uppercase mt-1">Internship Platform</p>
          </div>
        </div>
        <p className="text-zinc-400 max-w-xl text-lg font-light">
          Choose your portal to enter the workspace. Launch your career, manage talent, or coordinate the next generation of entrepreneurs.
        </p>
      </header>

      {/* Main Grid */}
      <main className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-6 pb-12 flex items-center justify-center">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full h-full max-h-[800px]">
          
          {/* New Intern - Primary Card */}
          <div className="group relative flex flex-col justify-between p-8 rounded-3xl bg-[#0a0810] border-2 border-[#D4AF37] overflow-hidden transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(212,175,55,0.3)] md:row-span-2 min-h-[300px] cursor-pointer">
            <div className="absolute inset-0 bg-gradient-to-br from-[#D4AF37]/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            
            <div className="relative z-10">
              <div className="w-16 h-16 rounded-2xl bg-[#D4AF37]/20 flex items-center justify-center mb-6 animate-float">
                <Sparkles className="w-8 h-8 text-[#D4AF37]" />
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] text-xs font-semibold uppercase tracking-wider mb-4">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4AF37] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#D4AF37]"></span>
                </span>
                Start Here
              </div>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">New Intern</h2>
              <p className="text-zinc-400 text-lg md:text-xl leading-relaxed max-w-sm">
                Begin your entrepreneurial journey. Register for our flagship internship program and gain real-world experience.
              </p>
            </div>
            
            <div className="relative z-10 mt-12 flex items-center justify-between pt-6 border-t border-[#D4AF37]/20">
              <span className="text-[#D4AF37] font-semibold text-lg">Apply Now</span>
              <button className="w-12 h-12 rounded-full bg-[#D4AF37] text-[#0a0810] flex items-center justify-center transition-transform group-hover:scale-110 animate-pulse-glow">
                <ArrowRight className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Student Login */}
          <div className="group relative flex flex-col justify-between p-8 rounded-3xl glass-panel border-l-4 border-l-[#3B82F6] overflow-hidden transition-all duration-300 hover:bg-white/[0.05] min-h-[280px] cursor-pointer">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#3B82F6]/10 rounded-full blur-[60px] -translate-y-1/2 translate-x-1/4 group-hover:bg-[#3B82F6]/20 transition-colors duration-500"></div>
            
            <div className="relative z-10">
              <div className="w-12 h-12 rounded-xl bg-[#3B82F6]/20 flex items-center justify-center mb-6">
                <GraduationCap className="w-6 h-6 text-[#3B82F6]" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">Student</h2>
              <p className="text-zinc-400 text-base leading-relaxed">
                Access your dashboard, track tasks, submit assignments, and communicate with coordinators.
              </p>
            </div>
            
            <div className="relative z-10 mt-8 flex items-center gap-3 text-[#3B82F6] font-medium group-hover:translate-x-2 transition-transform">
              <span>Sign In</span>
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Coordinator Login */}
            <div className="group relative flex flex-col justify-between p-8 rounded-3xl glass-panel border-l-4 border-l-[#6366F1] overflow-hidden transition-all duration-300 hover:bg-white/[0.05] min-h-[280px] cursor-pointer">
              <div className="absolute top-0 right-0 w-48 h-48 bg-[#6366F1]/10 rounded-full blur-[50px] -translate-y-1/2 translate-x-1/4 group-hover:bg-[#6366F1]/20 transition-colors duration-500"></div>
              
              <div className="relative z-10">
                <div className="w-12 h-12 rounded-xl bg-[#6366F1]/20 flex items-center justify-center mb-6">
                  <Users className="w-6 h-6 text-[#6366F1]" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Coordinator</h2>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  Manage student groups, assign tasks, and monitor daily progress.
                </p>
              </div>
              
              <div className="relative z-10 mt-6 flex items-center gap-3 text-[#6366F1] font-medium group-hover:translate-x-2 transition-transform">
                <span>Portal Login</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>

            {/* HR Login */}
            <div className="group relative flex flex-col justify-between p-8 rounded-3xl glass-panel border-l-4 border-l-[#10B981] overflow-hidden transition-all duration-300 hover:bg-white/[0.05] min-h-[280px] cursor-pointer">
              <div className="absolute top-0 right-0 w-48 h-48 bg-[#10B981]/10 rounded-full blur-[50px] -translate-y-1/2 translate-x-1/4 group-hover:bg-[#10B981]/20 transition-colors duration-500"></div>
              
              <div className="relative z-10">
                <div className="w-12 h-12 rounded-xl bg-[#10B981]/20 flex items-center justify-center mb-6">
                  <Briefcase className="w-6 h-6 text-[#10B981]" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">HR</h2>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  Review applications, issue offers, and oversee platform administration.
                </p>
              </div>
              
              <div className="relative z-10 mt-6 flex items-center gap-3 text-[#10B981] font-medium group-hover:translate-x-2 transition-transform">
                <span>Secure Login</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
}

export default RoleConstellation;