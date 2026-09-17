"use client";

import { useEffect, useState } from "react";

const playerIdentityKey = "penguin-fantasy:player-id:v1";

export default function RulesPlayerLink({ siteBasePath }: { siteBasePath: string }) {
  const [remembered, setRemembered] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        setRemembered(/^\d+$/.test(window.localStorage.getItem(playerIdentityKey) ?? ""));
      } catch {
        setRemembered(false);
      }
    });
    return () => { active = false; };
  }, []);

  return (
    <a className={`player-login-button ${remembered ? "player-login-active" : ""}`} href={`${siteBasePath}/#${remembered ? "my-ranking" : "ranking"}`}>
      <small>{remembered ? "已登录" : "PLAYER"}</small>
      <strong>{remembered ? "我的成绩" : "登录"}</strong>
    </a>
  );
}
