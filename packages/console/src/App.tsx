import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="container">
      <h1>React-in-HTML POC</h1>
      <p>Vite + TypeScript + React. No CDN, no Babel standalone.</p>
      <button onClick={() => setCount(c => c + 1)}>
        Clicked {count} time{count !== 1 ? 's' : ''}
      </button>
    </div>
  );
}
