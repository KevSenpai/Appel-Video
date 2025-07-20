import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import Home from './components/Home';
import CallRoom from './components/CallRoom';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/call/:callId" element={<CallRoom />} />
          {/* Ajoutez d'autres routes si nécessaire */}
        </Routes>
      </div>
    </Router>
  );
}

export default App;