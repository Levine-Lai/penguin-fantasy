'use client';

import { useEffect } from 'react';

const revealTargets = '.stage-slot, .stage-lore, .arena-home, .ranking-panel, .rule-stage';

export default function ScrollReveal() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!('IntersectionObserver' in window) || preference.matches) return;

    const tracked = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-scroll-reveal', 'visible');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -24px 0px', threshold: 0 });

    const register = (root: ParentNode) => {
      const candidates = [...root.querySelectorAll(revealTargets)];
      if (root instanceof Element && root.matches(revealTargets)) candidates.push(root);
      for (const element of candidates) {
        if (tracked.has(element)) continue;
        tracked.add(element);
        // Keep the first screen and any content without JavaScript fully visible.
        if (preference.matches || element.getBoundingClientRect().top < window.innerHeight) continue;
        element.setAttribute('data-scroll-reveal', 'pending');
        observer.observe(element);
      }
    };
    register(document);

    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) register(node);
      }
      for (const element of tracked) {
        if (element.isConnected) continue;
        observer.unobserve(element);
        tracked.delete(element);
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    const showAll = () => {
      if (!preference.matches) return;
      observer.disconnect();
      for (const element of tracked) element.removeAttribute('data-scroll-reveal');
    };
    preference.addEventListener('change', showAll);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      preference.removeEventListener('change', showAll);
      for (const element of tracked) element.removeAttribute('data-scroll-reveal');
    };
  }, []);
  return null;
}
