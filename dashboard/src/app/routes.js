/**
 * The seven pages, in the order a commander reads them.
 *
 * One list, used three times: the sidebar renders it, the router matches it, and the page
 * head takes its title from it. Adding a page means adding a row here and nothing else.
 *
 * The grouping is the reading order, not a taxonomy. Overview answers "what is the
 * battalion today". The three medical pages answer the same four questions of report
 * sick, MC and status in turn. People is for looking one person or one duty roster up.
 * Settings is what the other seven are reading from.
 */

import {
  McMaIcon,
  OrbatIcon,
  OverviewIcon,
  ReportSickIcon,
  SettingsIcon,
  SoldierIcon,
  StatusIcon,
} from './icons.jsx';

/**
 * Every page: its route, its label, its icon, and the sidebar group it sits in.
 * @type {!Array<{path: string, label: string, title: string, group: string, icon: function}>}
 */
export const ROUTES = [
  {
    path: '/overview',
    label: 'Overview',
    title: 'Battalion Overview',
    group: 'Overview',
    icon: OverviewIcon,
  },
  {
    path: '/report-sick',
    label: 'Report Sick',
    title: 'Report Sick',
    group: 'Medical',
    icon: ReportSickIcon,
  },
  {
    path: '/mc-ma',
    label: 'MC / MA',
    title: 'MC and Medical Appointments',
    group: 'Medical',
    icon: McMaIcon,
  },
  {
    path: '/status',
    label: 'Status',
    title: 'Status (Att B / LD)',
    group: 'Medical',
    icon: StatusIcon,
  },
  {
    path: '/soldier',
    label: 'Soldier',
    title: 'Soldier Search',
    group: 'People',
    icon: SoldierIcon,
  },
  {
    path: '/orbat',
    label: 'ORBAT',
    title: 'Order of Battle',
    group: 'People',
    icon: OrbatIcon,
  },
  {
    path: '/settings',
    label: 'Settings',
    title: 'Settings',
    group: '',
    icon: SettingsIcon,
  },
];

/** @type {string} Where an unknown or empty hash lands. */
export const DEFAULT_ROUTE = '/overview';

/**
 * Groups the routes for the sidebar, keeping declaration order.
 *
 * A route with no group name renders as its own ungrouped block at the foot of the rail,
 * which is where Settings belongs: reachable, but not part of the reading order.
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
