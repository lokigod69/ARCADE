import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import LauncherPage from './routes/LauncherPage';
import GamePage from './routes/GamePage';
import DevToolsPage from './routes/DevToolsPage';
import { ManifestProvider } from './state/ManifestContext';

function App() {
  return (
    <ManifestProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LauncherPage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/dev/tools" element={<DevToolsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ManifestProvider>
  );
}

export default App;
