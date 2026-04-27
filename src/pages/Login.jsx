import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Auth.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();

  const handleSubmit = async e => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      nav("/app");
    } catch (err) {
      setError("Invalid email or password. Try again.");
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-grid" />
      <div className="auth-card page-fade">
        <Link to="/" className="auth-logo">wete<em>kie</em></Link>
        <h1>Welcome back.</h1>
        <p className="auth-sub">Sign in to your space.</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? <span className="spin">◌</span> : "Sign in"}
          </button>
        </form>
        <p className="auth-switch">Don't have an account? <Link to="/signup">Join free</Link></p>
      </div>
    </div>
  );
}
