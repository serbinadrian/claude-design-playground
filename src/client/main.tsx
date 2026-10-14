import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@client/App';
import '@client/styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('The application root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
