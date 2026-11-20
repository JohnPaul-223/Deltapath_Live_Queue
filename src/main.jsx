import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'reactflow/dist/style.css';
import './app.css';

window.__deltapathApp = 'javascript-loaded';
createRoot(document.getElementById('root')).render(<App />);
window.__deltapathApp = 'react-render-requested';
