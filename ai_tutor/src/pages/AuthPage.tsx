import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { auth } from '../lib/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider 
} from 'firebase/auth';

const GoogleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 48 48">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s12-5.373 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z" />
        <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
    </svg>
);

const GlassInputWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-2xl border border-white/5 bg-white/5 backdrop-blur-sm transition-colors focus-within:border-cadmium/50 focus-within:bg-cadmium/10">
    {children}
  </div>
);

interface AuthPageProps {
  initialMode?: 'login' | 'signup';
  onClose: () => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ initialMode = 'login', onClose }) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col md:flex-row bg-[#0d0d0e] font-sans overflow-hidden">
      {/* Back Button */}
      <button onClick={onClose} className="absolute top-8 left-8 z-[110] text-white/40 hover:text-white transition-colors flex items-center gap-2">
        <ArrowLeft size={16} /> <span className="text-[10px] uppercase font-bold tracking-widest">Return</span>
      </button>

      {/* Left section: form */}
      <section className="flex-1 flex items-center justify-center p-8 md:p-16">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="flex flex-col gap-8">
            <h1 className="text-4xl md:text-5xl font-display font-medium leading-tight text-white mb-2">
              {mode === 'login' ? 'Welcome back.' : 'Join the archive.'}
            </h1>
            <p className="text-zinc-500 text-sm">
              {mode === 'login' ? 'Access your notes and continue your synthesis.' : 'Create an account to start interrogating your manuscripts.'}
            </p>

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-600 tracking-widest mb-2 block">Email Address</label>
                <GlassInputWrapper>
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@archive.co" 
                    className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none text-white placeholder:text-zinc-800"
                  />
                </GlassInputWrapper>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-600 tracking-widest mb-2 block">Password</label>
                <GlassInputWrapper>
                  <div className="relative">
                    <input 
                      type={showPassword ? 'text' : 'password'} 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••" 
                      className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl focus:outline-none text-white placeholder:text-zinc-800"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-4 flex items-center text-zinc-600 hover:text-white transition-colors">
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </GlassInputWrapper>
              </div>

              {error && <p className="text-red-500 text-xs font-medium">{error}</p>}

              <button 
                type="submit" 
                disabled={loading}
                className="w-full rounded-2xl bg-white text-black py-4 font-bold hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {loading && <Loader2 size={18} className="animate-spin" />}
                {mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <div className="relative flex items-center justify-center py-4">
              <span className="w-full border-t border-zinc-900"></span>
              <span className="px-4 text-[9px] uppercase font-bold text-zinc-700 bg-[#0d0d0e] absolute translate-y-[-1px] tracking-widest">Or access with</span>
            </div>

            <button onClick={handleGoogleSignIn} className="w-full flex items-center justify-center gap-3 border border-zinc-900 rounded-2xl py-4 hover:border-zinc-700 transition-all text-white text-sm font-medium">
                <GoogleIcon />
                Continue with Google
            </button>

            <p className="text-center text-xs text-zinc-600">
              {mode === 'login' ? "New to the platform?" : "Already have an account?"}{' '}
              <button 
                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                className="text-cadmium hover:underline transition-colors font-bold"
              >
                {mode === 'login' ? 'Create Account' : 'Sign In'}
              </button>
            </p>
          </div>
        </motion.div>
      </section>

      {/* Right section: Hero with generated image */}
      <section className="hidden md:block flex-1 relative p-4 overflow-hidden">
        <div 
          className="absolute inset-4 rounded-[2.5rem] bg-cover bg-center grayscale opacity-60" 
          style={{ backgroundImage: `url('/auth_hero.png')` }}
        ></div>
        <div className="absolute inset-4 rounded-[2.5rem] bg-gradient-to-t from-[#0d0d0e] via-transparent to-transparent"></div>
        
        {/* Floating Testimonials */}
        <div className="absolute bottom-12 left-12 right-12 flex flex-col gap-4">
           <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }} className="bg-white/5 backdrop-blur-xl border border-white/10 p-6 rounded-[2rem] max-w-md self-start">
              <p className="text-white text-sm italic font-medium">"The synthesis process is unparalleled. Interrogating my research papers has never been so efficient."</p>
              <p className="mt-4 text-[9px] uppercase font-bold tracking-widest text-cadmium">— Dr. Emily Chen, Physics Researcher</p>
           </motion.div>
           <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 }} className="bg-white/5 backdrop-blur-xl border border-white/10 p-6 rounded-[2rem] max-w-sm self-end">
              <p className="text-white text-sm italic font-medium">"Tewtr turned my chaotic lecture notes into a structured discourse."</p>
              <p className="mt-4 text-[9px] uppercase font-bold tracking-widest text-cadmium">— James Miller, Stanford Graduate</p>
           </motion.div>
        </div>
      </section>
    </div>
  );
};

export default AuthPage;
