// PilotLog cloud sync — Firebase (Google sign-in + Firestore).
//
// This is the SOURCE file. The app loads the bundled build at js/cloud.js;
// rebuild it after editing with:  node tools/build-cloud.mjs
//
// The app core (js/app.js) exposes window.PilotLogCore (merge logic, state,
// UI plumbing); this module exposes window.PilotLogCloud (sign-in and push).
// The whole logbook is stored as one JSON document at users/{uid}/app/logbook,
// readable/writable only by that user (see the Firestore rules in README.md).

import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut,
} from "firebase/auth";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

// When the app is served from Firebase Hosting, use that same host as the
// authDomain: the sign-in handshake is then same-origin, which is the only
// flow Safari/iOS allows (its tracking prevention blocks the cross-site
// handshake that the default firebaseapp.com authDomain requires).
const HOSTING_DOMAINS = ["pilotlog-9c6e1.web.app", "pilotlog-9c6e1.firebaseapp.com"];
const firebaseConfig = {
  apiKey: "AIzaSyD7_Fa-B8NA8GzC8mwDTae4YTk6-aoKZQg",
  authDomain: HOSTING_DOMAINS.includes(location.host) ? location.host : "pilotlog-9c6e1.firebaseapp.com",
  projectId: "pilotlog-9c6e1",
  storageBucket: "pilotlog-9c6e1.firebasestorage.app",
  messagingSenderId: "361227333811",
  appId: "1:361227333811:web:0913b5f464ea62de0fc0c6",
};

const core = window.PilotLogCore;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let user = null;
let unsubscribe = null;
let lastRemoteJson = null;
let pushTimer = null;

const docRef = () => doc(db, "users", user.uid, "app", "logbook");

function markOk() {
  core.updateSyncIndicator("ok");
  core.setSyncStatusText("Synced " + new Date().toLocaleTimeString() +
    (user?.email ? " as " + user.email : ""));
}

function fail(err) {
  console.warn("PilotLog sync:", err);
  core.updateSyncIndicator("error");
  const msg = err?.code === "permission-denied"
    ? "permission denied — the Firestore security rules aren't published yet (see README)."
    : (err?.message || String(err));
  core.setSyncStatusText("Sync error: " + msg);
}

onAuthStateChanged(auth, u => {
  user = u;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  lastRemoteJson = null;
  if (u) {
    core.updateSyncIndicator("busy");
    core.setSyncStatusText("Signed in as " + (u.email || u.displayName) + " — syncing…");
    unsubscribe = onSnapshot(docRef(), snap => {
      try {
        if (snap.exists() && typeof snap.data().json === "string") {
          lastRemoteJson = snap.data().json;
          const res = core.mergeRemote(JSON.parse(lastRemoteJson));
          if (res.differsFromRemote) schedulePush(300);
          else markOk();
        } else {
          // first device to sign in: publish what we have locally
          schedulePush(300);
        }
      } catch (err) { fail(err); }
    }, fail);
  } else {
    core.updateSyncIndicator();
    core.setSyncStatusText("");
  }
  core.refreshSyncDialog();
});

getRedirectResult(auth).catch(fail);

function schedulePush(delay = 1200) {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, delay);
}

async function pushNow() {
  if (!user) return;
  try {
    core.updateSyncIndicator("busy");
    const merged = lastRemoteJson
      ? core.mergeRemote(JSON.parse(lastRemoteJson)).merged
      : core.getState();
    const json = JSON.stringify(merged);
    if (json === lastRemoteJson) { markOk(); return; }

    const write = setDoc(docRef(), { json, updatedAt: Date.now() });
    // Offline, the SDK holds the write until reconnection — don't spin forever.
    const timedOut = await Promise.race([
      write.then(() => false),
      new Promise(res => setTimeout(() => res(true), 6000)),
    ]);
    if (timedOut) {
      core.updateSyncIndicator("error");
      core.setSyncStatusText("Waiting for a connection — changes will sync automatically.");
      write.then(() => { lastRemoteJson = json; markOk(); }).catch(fail);
      return;
    }
    lastRemoteJson = json;
    markOk();
  } catch (err) { fail(err); }
}

async function signIn() {
  const provider = new GoogleAuthProvider();
  // Same-origin authDomain (Firebase Hosting): full-page redirect is the
  // reliable path on iOS/Safari, where popups are flaky in installed PWAs.
  if (location.host === firebaseConfig.authDomain) {
    try { await signInWithRedirect(auth, provider); } catch (err) { fail(err); }
    return;
  }
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err?.code === "auth/popup-closed-by-user" || err?.code === "auth/cancelled-popup-request") {
      return; // user changed their mind
    }
    if (err?.code === "auth/popup-blocked" || err?.code === "auth/operation-not-supported-in-this-environment") {
      try { await signInWithRedirect(auth, provider); } catch (e2) { fail(e2); }
      return;
    }
    fail(err);
  }
}

async function signOutUser() {
  clearTimeout(pushTimer);
  await signOut(auth);
}

window.PilotLogCloud = {
  signIn,
  signOutUser,
  schedulePush,
  syncNow: () => schedulePush(0),
  isSignedIn: () => !!user,
  userEmail: () => user?.email || user?.displayName || "",
};
core.refreshSyncDialog();
