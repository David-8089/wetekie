import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Auth.css";

export default function Signup() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const nav = useNavigate();

  const handleSubmit = async e => {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (username.length < 2) return setError("Username must be at least 2 characters.");
    setLoading(true);
    try {
      await signup(username, email, password);
      nav("/app");
    } catch (err) {
      if (err.code === "auth/email-already-in-use") setError("Email already in use.");
      else setError("Something went wrong. Try again.");
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-grid" />
      <div className="auth-card page-fade">
        <Link to="/" className="auth-logo">wete<em>kie</em></Link>
        <h1>Join Wetekie.</h1>
        <p className="auth-sub">Free for students. Always.</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="yourname" required />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="min. 6 characters" required />
          </div>
          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? <span className="spin">◌</span> : "Create my account"}
          </button>
        </form>
        <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
        <p className="auth-note">By signing up you agree to our terms. No spam, ever.</p>
      </div>
    </div>
  );
}
