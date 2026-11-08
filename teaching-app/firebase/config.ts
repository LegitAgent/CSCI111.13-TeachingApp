
// Import the functions you need from the SDKs you need
// https://firebase.google.com/docs/web/setup#available-libraries
import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";  
import { getAuth } from "firebase/auth";  

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDnasLh9-Fa6RJzKTyC5um0-_DE4PKYA-0",
  authDomain: "csci-teachingapp.firebaseapp.com",
  projectId: "csci-teachingapp",
  storageBucket: "csci-teachingapp.firebasestorage.app",
  messagingSenderId: "108261680822",
  appId: "1:108261680822:web:1ba9c5616d34c443122817",
  measurementId: "G-M67EH4S87Q"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app)
// export const dbstore = 
// const analytics = getAnalytics(app);	
