/**
 * The eight pages, in the order a commander reads them.
 *
 * One list, used three times: the sidebar renders it, the router matches it, and the
 * narrow-screen top bar takes its label from it. Adding a page means adding a row here
 * and nothing else.
 *
 * The grouping is the reading order, not a taxonomy. Overview answers "what is the
 * battalion today". The three medical pages answer the same four questions of report
 * sick, MC and status in turn. People is for looking one person or one duty roster up.
 * Deposit and Settings sit at the foot: the first is where a clerk deposits or
 * corrects a parade state, the second is what the rest are reading from.
 */

import {
  DepositIcon,
  McMaIcon,
  OrbatIcon,
  OverviewIcon,
  ReportSickIcon,
  SettingsIcon,
  SoldierIcon,
  StatusIcon,
} from './icons.jsx';
import { Overview } from '../pages/Overview.jsx';
import { ReportSick } from '../pages/ReportSick.jsx';
import { McMa } from '../pages/McMa.jsx';
import { Status } from '../pages/Status.jsx';
import { Soldier } from '../pages/Soldier.jsx';
import { Orbat } from '../pages/Orbat.jsx';
import { Deposit } from '../pages/Deposit.jsx';
import { Settings } from '../pages/Settings.jsx';

/**
 * Every page: its route, its component, its label, its icon, and the sidebar group it sits in.
 * @type {!Array<{path: string, component: function, label: string, group: string, icon: function}>}
 */
export const ROUTES = [
  {
    path: '/overview',
    component: Overview,
    label: 'Overview',
    group: 'Overview',
    icon: OverviewIcon,
  },
  {
    path: '/report-sick',
    component: ReportSick,
    label: 'Report Sick',
    group: 'Medical',
    icon: ReportSickIcon,
  },
  {
    path: '/mc-ma',
    component: McMa,
    label: 'MC / MA',
    group: 'Medical',
    icon: McMaIcon,
  },
  {
    path: '/status',
    component: Status,
    label: 'Status',
    group: 'Medical',
    icon: StatusIcon,
  },
  {
    path: '/soldier',
    component: Soldier,
    label: 'Soldier',
    group: 'People',
    icon: SoldierIcon,
  },
  {
    path: '/orbat',
    component: Orbat,
    label: 'ORBAT',
    group: 'People',
    icon: OrbatIcon,
  },
  {
    path: '/deposit',
    component: Deposit,
    label: 'Deposit',
    group: '',
    icon: DepositIcon,
  },
  {
    path: '/settings',
    component: Settings,
    label: 'Settings',
    group: '',
    icon: SettingsIcon,
  },
];

/** @type {string} Where an unknown or empty hash lands. */
export const DEFAULT_ROUTE = '/overview';

/**
 * Groups the routes for the sidebar, keeping declaration order.
 *
 * Routes with no group name render as one ungrouped block at the foot of the rail, which
 * is where Deposit and Settings belong: reachable, but not part of the reading order.
 * @returns {!Array<{name: string, routes: !Array<!Object>}>} Groups in sidebar order.
 */
export function navGroups() {
  const groups = [];
  ROUTES.forEach((route) => {
    const last = groups[groups.length - 1];
    if (last && last.name === route.group) {
      last.routes.push(route);
      return;
    }
    groups.push({ name: route.group, routes: [route] });
  });
  return groups;
}

/**
 * Finds the route a path names.
 * @param {string} path The current route path.
 * @returns {?Object} The route, or null when the path names none.
 */
export function routeAt(path) {
  return ROUTES.find((route) => route.path === path) || null;
}
