import { useAuth } from '@/hooks/useAuth';

const DemoModeBadge = () => {
  const { isDemoMode } = useAuth();

  if (!isDemoMode) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-orange-500/90 text-white px-3 py-1 rounded-full text-sm font-medium shadow-lg backdrop-blur-sm">
        Demo Mode
      </div>
    </div>
  );
};

export default DemoModeBadge;