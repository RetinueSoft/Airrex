// The agency's header/footer as shown on printed tickets (screen preview).
// The printed version is drawn onto the page canvas by drawBrandHeader/drawBrandFooter (same layout).

import type { AgentProfile } from '../../shared/types.ts';

export function AgencyHeader({ agent }: { agent: AgentProfile }) {
  const contact = [agent.phone && `📞 ${agent.phone}`, agent.whatsapp && agent.whatsapp !== agent.phone && `WhatsApp ${agent.whatsapp}`, agent.website]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <div className="agency-header" style={{ borderColor: agent.brandColor }}>
      {agent.logo ? <img src={agent.logo} alt="" className="agency-logo" /> : <span className="agency-initial" style={{ background: agent.brandColor }}>{agent.agencyName.slice(0, 1).toUpperCase()}</span>}
      <div className="agency-lines">
        <div className="agency-name" style={{ color: agent.brandColor }}>{agent.agencyName || 'Your agency name'}</div>
        {(agent.address || agent.city) && <div>{[agent.address, agent.city].filter(Boolean).join(', ')}</div>}
        {contact && <div>{contact}</div>}
        {agent.gstin && <div>GSTIN: {agent.gstin}</div>}
      </div>
    </div>
  );
}

export function AgencyFooter({ agent, note }: { agent: AgentProfile; note?: string }) {
  const text = [note, agent.ticketFooter].filter(Boolean).join('  ·  ');
  return (
    <div className="agency-footer" style={{ borderColor: agent.brandColor }}>
      {text || `Booked through ${agent.agencyName}`}
    </div>
  );
}
