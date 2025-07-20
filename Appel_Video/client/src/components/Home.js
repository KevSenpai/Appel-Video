import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import './Home.css';

const socket = io('http://localhost:3001'); // Connexion au serveur de signalisation

function Home() {
  const [callIdInput, setCallIdInput] = useState('');
  const navigate = useNavigate();

  const handleCreateCall = () => {
    socket.emit('createCall', ({ callId, userId }) => {
      console.log(`Appel créé: ${callId}, Utilisateur: ${userId}`);
      navigate(`/call/${callId}`, { state: { userId } });
    });
  };

  const handleJoinCall = () => {
    if (callIdInput.trim()) {
      socket.emit('joinCall', { callId: callIdInput }, ({ success, message, callId, userId }) => {
        if (success) {
          console.log(`Appel rejoint: ${callId}, Utilisateur: ${userId}`);
          navigate(`/call/${callId}`, { state: { userId } });
        } else {
          alert(message); // Afficher un message d'erreur à l'utilisateur
        }
      });
    } else {
      alert('Veuillez entrer un ID d\'appel pour rejoindre.');
    }
  };

  return (
    <div className="home-container">
      <h1>Bienvenue sur l'application de communication P2P !</h1>
      <div className="action-section">
        <button onClick={handleCreateCall}>Créer un nouvel appel</button>
      </div>
      <div className="action-section">
        <input
          type="text"
          placeholder="Entrez l'ID de l'appel"
          value={callIdInput}
          onChange={(e) => setCallIdInput(e.target.value)}
        />
        <button onClick={handleJoinCall}>Rejoindre un appel existant</button>
      </div>
    </div>
  );
}

export default Home;