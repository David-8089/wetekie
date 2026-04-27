import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";


const firebaseConfig = {
  apiKey: "AIzaSyCPNNrnwx95kN3ejPhfJBCTUTNYFISTerQ",
  authDomain: "wetekie.firebaseapp.com",
  projectId: "wetekie",
  storageBucket: "wetekie.firebasestorage.app",
  messagingSenderId: "303042338406",
  appId: "1:303042338406:web:ad1b46968ec873195c17a7"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;