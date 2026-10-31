import React, { useState } from 'react';
import LoadNumber from './LoadNumber.jsx';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Clock3,
  Mail,
  KeyRound,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Route,
  Trash2,
  Truck,
} from 'lucide-react';
import { formatDateTime } from '../i18n/format';
import { loadStatusLabel } from '../i18n/labels';
import './driverProfilePanel.css';
import DriverPasswordModal from './DriverPasswordModal';
import { activeLoadsForDriver, driverRosterState } from './driverRosterModel';

function isCompleted(load) {
  return load.databaseStatus
    ? load.databaseStatus === 'completed'
    : load.status === 'COMPLETED';
}

function routeLabel(load) {
  const origin = [load.origin?.city, load.origin?.state].filter(Boolean).join(', ');
  const destination = [load.destination?.city, load.destination?.state].filter(Boolean).join(', ');
  return [origin, destination].filter(Boolean).join(' → ') || '—';
}

function Fact({ icon: Icon, label, children }) {
  return <div className="cdp-fact">
    <dt><Icon size={16} aria-hidden="true" />{label}</dt>
    <dd>{children}</dd>
  </div>;
}

function Metric({ value, label, accent = false }) {
  return <div className={`cdp-metric${accent ? ' is-accent' : ''}`}>
    <strong>{value}</strong><span>{label}</span>
  </div>;
}

export default function DriverProfilePanel({
  driver,
  loads = [],
  canManage = false,
  deleting = false,
  onBack,
  onEdit,
  onAssignVehicle,
  onAssignLoad,
  onOpenChat,
  onOpenLoad,
  onDelete,
}) {
  const { t } = useTranslation();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const driverLoads = loads.filter((load) => (
    load.driverId === driver.id || load.targetDriverIds?.includes(driver.id)
  ));
  const activeLoads = activeLoadsForDriver(driverLoads, driver.id);
  const completedLoads = driverLoads.filter(isCompleted).length;
  const state = driverRosterState(driver, activeLoads);
  const stateLabel = t(state === 'SUSPENDED' ? 'driverSettings.suspended' : state === 'OFF_DUTY' ? 'driverStatus.off_duty' : state === 'ON_LOAD' ? 'drivers.onLoad' : 'drivers.available');
  const vehicle = driver.vehicle;

  return (
    <section id="company-members-panel" aria-labelledby="driver-profile-title" className="company-driver-profile">
      <button type="button" onClick={onBack} className="cdp-back">
        <ArrowLeft size={16} aria-hidden="true" />{t('header.backToDrivers')}
      </button>

      <header className="cdp-header">
        <div className="cdp-identity">
          <div className="cdp-avatar">
            {driver.avatar
              ? <img src={driver.avatar} alt="" />
              : <span aria-hidden="true">{driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}</span>}
          </div>
          <div className="cdp-name">
            <div><h2 id="driver-profile-title">{driver.name}</h2><span className="cdp-badge"><i aria-hidden="true" />{stateLabel}</span></div>
            <p>{driver.driverNumber || t('common.notProvided')}</p>
          </div>
        </div>
        <div className="cdp-actions">
          <button type="button" onClick={() => onAssignLoad?.(driver)} disabled={state === 'SUSPENDED'} className="cdp-button is-primary"><Plus size={16} aria-hidden="true" />{t('drivers.assignLoad')}</button>
          <button type="button" onClick={() => onOpenChat?.(driver)} className="cdp-button"><MessageSquare size={16} aria-hidden="true" />{t('drivers.openChat')}</button>
          {canManage && <button type="button" onClick={() => onEdit?.(driver)} className="cdp-button"><Pencil size={16} aria-hidden="true" />{t('common.edit')}</button>}
        </div>
      </header>

      <div className="cdp-columns">
        <div className="cdp-details">
          <section className="cdp-card">
            <h3>{t('drivers.details')}</h3>
            <dl className="cdp-facts">
              <Fact icon={Phone} label={t('common.phone')}>{driver.phone ? <a href={`tel:${driver.phone}`}>{driver.phone}</a> : t('common.notProvided')}</Fact>
              <Fact icon={Mail} label={t('common.email')}>{driver.email || t('common.notProvided')}</Fact>
              <Fact icon={MapPin} label={t('drivers.location')}>{driver.currentLocation || t('common.offline')}</Fact>
              <Fact icon={Clock3} label={t('drivers.lastSeen')}>{driver.lastSeenAt ? formatDateTime(driver.lastSeenAt) : t('drivers.neverSeen')}</Fact>
            </dl>
          </section>

          {canManage && <section className="cdp-card" aria-label={t('driverPassword.manage')}>
            <div className="cdp-card-heading">
              <h3><KeyRound size={18} aria-hidden="true" />{t('driverPassword.manage')}</h3>
              <button type="button" className="cdp-button" aria-label={t('driverPassword.manage')} aria-haspopup="dialog" aria-expanded={passwordOpen} onClick={() => setPasswordOpen(true)}>{t('driverPassword.open')}</button>
            </div>
          </section>}

          <section className="cdp-card">
            <div className="cdp-card-heading">
              <h3><Truck size={18} aria-hidden="true" />{t('drivers.vehicleDetails')}</h3>
              {canManage && <button type="button" onClick={() => onAssignVehicle?.(driver)} className="cdp-link">{t('fleet.openAssignment')}</button>}
            </div>
            {vehicle ? <div className="cdp-vehicle">
              <div className="cdp-vehicle-heading">
                <span className="cdp-vehicle-icon"><Truck size={22} aria-hidden="true" /></span>
                <div><strong>#{vehicle.number}</strong><p>{`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()}</p></div>
                <span className="cdp-badge">{t('common.active')}</span>
              </div>
              <dl className="cdp-vehicle-facts">
                <div><dt>{t('fleet.vin')}</dt><dd>{vehicle.vin || t('common.notProvided')}</dd></div>
                <div><dt>{t('fleet.plate')}</dt><dd>{[vehicle.plateState, vehicle.plateNumber].filter(Boolean).join(' · ') || t('common.notProvided')}</dd></div>
                <div><dt>{t('drivers.trailer')}</dt><dd>{driver.trailer || t('common.notProvided')}</dd></div>
              </dl>
            </div> : <button type="button" onClick={() => canManage && onAssignVehicle?.(driver)} disabled={!canManage} className="cdp-empty-vehicle"><Truck size={24} aria-hidden="true" />{t('fleet.unassigned')}</button>}
          </section>
        </div>

        <aside className="cdp-history">
          <div className="cdp-metrics">
            <Metric value={driverLoads.length} label={t('drivers.tripHistory')} />
            <Metric value={activeLoads.length} label={t('drivers.activeTrips')} accent />
            <Metric value={completedLoads} label={t('loadStatus.completed')} />
          </div>
          <section className="cdp-card">
            <div className="cdp-card-heading"><h3><Route size={18} aria-hidden="true" />{t('drivers.tripHistory')}</h3><span className="cdp-count">{driverLoads.length}</span></div>
            <div className="cdp-loads">
              {driverLoads.length ? driverLoads.slice(0, 5).map(load => <button key={load.id} type="button" onClick={() => onOpenLoad?.(load)} className="cdp-load">
                <span className="cdp-load-heading"><strong><LoadNumber load={load} /></strong><span>{loadStatusLabel(t, load.status)}</span></span>
                <span className="cdp-load-route">{routeLabel(load)}</span>
              </button>) : <div className="cdp-empty">{t('drivers.noCurrentLoad')}</div>}
            </div>
          </section>
          {canManage && onDelete && <div className="cdp-danger-zone"><button type="button" onClick={() => onDelete(driver)} disabled={deleting} className="cdp-button is-danger"><Trash2 size={16} aria-hidden="true" />{t('profile.remove')}</button></div>}
        </aside>
      </div>
    {canManage && passwordOpen && <DriverPasswordModal driver={driver} onClose={() => setPasswordOpen(false)} />}
    </section>
  );
}
