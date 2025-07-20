import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import io from 'socket.io-client';
import './CallRoom.css';

const socket = io('http://localhost:3001'); // Connexion au serveur de signalisation

function CallRoom() {
  const { callId } = useParams();
  const location = useLocation();
  const { userId } = location.state || {};

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    if (!userId) {
      // Rediriger si l'userId n'est pas présent (ex: accès direct à l'URL)
      alert("Accès non autorisé. Veuillez créer ou rejoindre un appel depuis la page d'accueil.");
      window.location.href = '/';
      return;
    }

    console.log(`[CallRoom] Tentative de rejoindre l'appel ${callId} avec userId ${userId}`);
    socket.emit('joinCall', { callId }, ({ success, message, callId: joinedCallId, userId: joinedUserId }) => {
      if (!success) {
        alert(message);
        window.location.href = '/';
        return;
      }
      console.log(`[CallRoom] Rejoint l'appel ${joinedCallId} en tant que ${joinedUserId}`);
      setIsCallActive(true);
      setParticipants([joinedUserId]); // Initialiser avec soi-même

      startLocalStream().then(localStream => {
        socket.on('userJoined', ({ userId: newUserId }) => {
          console.log(`[Socket.IO] Utilisateur ${newUserId} a rejoint l'appel.`);
          setParticipants((prev) => [...prev, newUserId]);
          createPeerConnection(newUserId, true, localStream); // Créer une offre pour le nouvel utilisateur
        });

        socket.on('userLeft', ({ userId: leavingUserId }) => {
          console.log(`[Socket.IO] Utilisateur ${leavingUserId} a quitté l'appel.`);
          setParticipants((prev) => prev.filter((id) => id !== leavingUserId));
          // Gérer la fermeture de la connexion PeerConnection associée si nécessaire
          if (peerConnection.current) {
            peerConnection.current.close();
            peerConnection.current = null;
          }
        });

        socket.on('signal', async ({ senderUserId, signalData }) => {
          console.log(`[Socket.IO] Signal reçu de ${senderUserId}:`, signalData.type);
          if (!peerConnection.current) {
            createPeerConnection(senderUserId, false, localStream); // Créer une réponse pour l'utilisateur existant
          }

          try {
            if (signalData.type === 'offer') {
              await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signalData));
              const answer = await peerConnection.current.createAnswer();
              await peerConnection.current.setLocalDescription(answer);
              socket.emit('signal', { recipientUserId: senderUserId, signalData: peerConnection.current.localDescription });
            } else if (signalData.type === 'answer') {
              await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signalData));
            } else if (signalData.type === 'candidate') {
              await peerConnection.current.addIceCandidate(new RTCIceCandidate(signalData));
            }
          } catch (e) {
            console.error('Erreur lors du traitement du signal:', e);
          }
        });
      }).catch(err => {
        console.error('[CallRoom] Erreur lors du démarrage du flux local:', err);
        alert('Impossible de démarrer votre caméra/microphone. Veuillez vérifier les permissions.');
        window.location.href = '/'; // Rediriger en cas d'échec critique
      });
    });

    const currentLocalVideoElement = localVideoRef.current;

    return () => {
      console.log('[CallRoom] Nettoyage: Déconnexion du socket et fermeture de la PeerConnection.');
      socket.off('userJoined');
      socket.off('userLeft');
      socket.off('signal');
      socket.emit('disconnect'); // Informer le serveur que l'utilisateur quitte
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      if (currentLocalVideoElement && currentLocalVideoElement.srcObject) {
        currentLocalVideoElement.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, [callId, userId]);

  const startLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideoRef.current.srcObject = stream;
      console.log('[WebRTC] Flux local démarré.');
      return stream; // Retourner le stream
    } catch (err) {
      console.error('[WebRTC] Erreur lors de l\'accès aux médias locaux:', err);
      throw err; // Propager l'erreur pour la gérer dans useEffect
    }
  };

  const createPeerConnection = (remoteUserId, isCreator, localStream) => {
    console.log(`[WebRTC] Création de PeerConnection pour ${remoteUserId}. IsCreator: ${isCreator}`);
    // Fermer la connexion existante si elle est active (pour un scénario 1:1)
    if (peerConnection.current) {
      console.log('[WebRTC] Fermeture de la PeerConnection existante.');
      peerConnection.current.close();
      peerConnection.current = null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Ajoutez des serveurs TURN si nécessaire pour les réseaux complexes
      ],
    });

    // Ajouter les pistes locales au PeerConnection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
      console.log('[WebRTC] Pistes locales ajoutées à la PeerConnection.');
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC] Envoi d'ICE candidate à ${remoteUserId}`);
        socket.emit('signal', { recipientUserId: remoteUserId, signalData: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] Piste distante reçue.');
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onnegotiationneeded = async () => {
      if (isCreator) {
        try {
          console.log('[WebRTC] Création de l\'offre SDP.');
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('signal', { recipientUserId: remoteUserId, signalData: pc.localDescription });
        } catch (e) {
          console.error('Erreur lors de la création de l\'offre:', e);
        }
      }
    };

    peerConnection.current = pc;
    return pc;
  };

  const toggleMute = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      });
    }
  };

  const toggleCamera = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
        setIsCameraOff(!track.enabled);
      });
    }
  };

  const handleEndCall = () => {
    // Le nettoyage est géré dans le useEffect return
    window.location.href = '/'; // Rediriger vers la page d'accueil
  };

  if (!isCallActive) {
    return <div className="call-room-container">Chargement de l'appel...</div>;
  }

  return (
    <div className="call-room-container">
      <h2>Appel en cours: {callId}</h2>
      <p>Votre ID: {userId}</p>
      <p>Participants: {participants.join(', ')}</p>
      <div className="video-streams">
        <div className="local-video-container">
          <video ref={localVideoRef} autoPlay muted playsInline className="local-video"></video>
          <p>Votre vidéo</p>
        </div>
        <div className="remote-video-container">
          <video ref={remoteVideoRef} autoPlay playsInline className="remote-video"></video>
          <p>Vidéo distante</p>
        </div>
      </div>
      <div className="controls">
        <button onClick={toggleMute}>{isMuted ? 'Activer le micro' : 'Couper le micro'}</button>
        <button onClick={toggleCamera}>{isCameraOff ? 'Activer la caméra' : 'Couper la caméra'}</button>
        <button onClick={handleEndCall} className="end-call-button">Quitter l'appel</button>
      </div>
    </div>
  );
}

export default CallRoom;