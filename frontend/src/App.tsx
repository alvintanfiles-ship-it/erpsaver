import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { TripPlanner } from './pages/TripPlanner';
import { ParkingResults } from './pages/ParkingResults';
import { NavigationView } from './pages/NavigationView';
import { Settings } from './pages/Settings';
import { Header } from './components/Header';
import { useThemeStore } from './stores/themeStore';

function App() {
  const { theme, initializeTheme } = useThemeStore();

  // Initialize theme once on mount
  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  return (
    <div className={`app ${theme}`} data-theme={theme}>
      <Header />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<TripPlanner />} />
          <Route path="/parking" element={<ParkingResults />} />
          <Route path="/navigate" element={<NavigationView />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;