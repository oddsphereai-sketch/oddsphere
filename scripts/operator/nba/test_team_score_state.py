"""Independent dense probability/chronology controls for C5, no network/DB."""
import copy
import math
import unittest

import numpy as np
from numpy.testing import assert_allclose
from scipy.linalg import cho_factor, cho_solve

from team_score_state import (BASELINE, SOURCE, RELEASE, arrays, digest, forecast,
                              instant, likelihood, observation, posterior, training_rows)


def row(i=1, season=2023, start='2023-11-01T00:00:00Z', cutoff='2023-10-31T23:00:00Z',
        final='2023-11-01T03:00:00Z', home=1, away=2):
    return {'gameId': f'{i:010d}', 'season': season, 'startAt': start, 'cutoff': cutoff,
            'finalAvailableAt': final, 'homeTeamId': home, 'awayTeamId': away,
            'baselineHash': 'b'*64, 'sourceSha256': 'a'*64, 'sourceRecipe': SOURCE,
            'baselineRecipe': BASELINE, 'baselineTrainingEnd': '2023-04-01T00:00:00Z',
            'baselineMargin': 4., 'baselineTotal': 220., 'homeScore': 120, 'awayScore': 108}


def head():
    return {'release': RELEASE, 'sourceRecipe': SOURCE, 'baselineRecipe': BASELINE,
            'trainingSeason': 2022, 'trainingEnd': '2023-04-01T00:00:00Z', 'teams': [1, 2, 3],
            'parameters': {'scoringVariance': 4., 'preventionVariance': 3., 'noiseVariance': 90., 'lengthDays': 12.}}


def dense(params, records, teams, target_time=None, target_h=None):
    scoring, prevention, noise, length = params
    q = np.diag([scoring]*len(teams)+[prevention]*len(teams))
    n = len(records)*2
    k = np.empty((n, n))
    for i, (ti, hi, _) in enumerate(records):
        for j, (tj, hj, _) in enumerate(records):
            k[2*i:2*i+2, 2*j:2*j+2] = (hi@q@hj.T)*math.exp(-abs(ti-tj)/length)
    factor = cho_factor(k+np.eye(n)*noise, lower=True)
    y = np.concatenate([r[2] for r in records])
    alpha = cho_solve(factor, y)
    nll = .5*(n*math.log(2*math.pi)+2*np.log(np.diag(factor[0])).sum()+y@alpha)
    if target_time is None:
        return nll
    cross = np.concatenate([(target_h@q@h.T)*math.exp(-(target_time-t)/length) for t, h, _ in records], axis=1)
    return cross@alpha, target_h@q@target_h.T-cross@cho_solve(factor, cross.T)


class TeamScoreStateTests(unittest.TestCase):
    def records(self):
        teams = [1, 2, 3]
        specifications = [(0., 1, 2, [8., -4.]), (0., 3, 1, [-2., 3.]),
                          (2., 2, 3, [1., 4.]), (6., 1, 3, [-7., 2.])]
        return teams, [(t, observation({'homeTeamId': h, 'awayTeamId': a}, teams), np.array(y))
                       for t, h, a, y in specifications]

    def test_dense_likelihood_and_independent_finite_difference_gradient(self):
        teams, records = self.records()
        logp = np.log([4., 3., 90., 12.])
        value, gradient = likelihood(logp, records, len(teams))
        self.assertAlmostEqual(value, dense(np.exp(logp), records, teams), places=11)
        numerical = []
        for i in range(4):
            delta = np.eye(4)[i]*1e-5
            numerical.append((dense(np.exp(logp+delta), records, teams)-dense(np.exp(logp-delta), records, teams))/2e-5)
        assert_allclose(gradient, numerical, atol=2e-8, rtol=2e-7)

    def test_vector_filter_matches_dense_gp_posterior_with_shared_teams(self):
        teams, records = self.records()
        params = [4., 3., 90., 12.]
        h = observation({'homeTeamId': 3, 'awayTeamId': 2}, teams)
        actual = posterior(params, records, len(teams), 8., h)
        expected = dense(params, records, teams, 8., h)
        for a, b in zip(actual, expected):
            assert_allclose(a, b, atol=1e-11, rtol=1e-11)
        # The cross-team posterior is not independent averages.
        self.assertGreater(abs(actual[1][0, 1]), 0.)

    def test_no_prior_identity_and_score_covariance(self):
        target = row()
        before = digest(target)
        result = forecast(head(), target, [])
        self.assertEqual((result['margin'], result['total']), (4., 220.))
        self.assertEqual(result['observationsUsed'], 0)
        assert_allclose(result['stateScoreCovariance'], np.eye(2)*7.)
        self.assertEqual(before, digest(target))

    def test_target_future_season_and_cutoff_poisons_and_immutability(self):
        prior = row()
        target = row(2, start='2023-11-03T00:00:00Z', cutoff='2023-11-02T23:00:00Z', final='2023-11-03T03:00:00Z')
        expected = forecast(head(), target, [prior])
        target_poison = {**target, 'homeScore': 'poison', 'awayScore': None}
        future = row(3, start='2023-11-04T00:00:00Z', cutoff='2023-11-03T23:00:00Z', final='2023-11-04T03:00:00Z')
        late = {**prior, 'gameId': '0000000004', 'finalAvailableAt': '2023-11-03T01:00:00Z', 'homeScore': 'poison'}
        foreign_season = {**prior, 'gameId': '0000000005', 'season': 2022, 'homeScore': 'poison'}
        observations = [prior, target_poison, {**future, 'homeScore': 'poison'}, late, foreign_season]
        before = digest(observations)
        self.assertEqual(expected, forecast(head(), target_poison, observations))
        self.assertEqual(before, digest(observations))
        target.pop('homeScore')
        target.pop('awayScore')
        self.assertEqual(expected, forecast(head(), target, [prior]))

    def test_duplicates_conflicts_foreign_baseline_and_native_unknowns(self):
        prior = row()
        target = row(2, start='2023-11-03T00:00:00Z', cutoff='2023-11-02T23:00:00Z', final='2023-11-03T03:00:00Z')
        self.assertEqual(forecast(head(), target, [prior]), forecast(head(), target, [prior, copy.deepcopy(prior)]))
        for bad in [{**prior, 'homeScore': 121}, {**prior, 'baselineHash': 'c'*64},
                    {**prior, 'sourceSha256': 'bad'}, {**prior, 'homeTeamId': 99}]:
            with self.assertRaises(ValueError):
                forecast(head(), target, [prior, bad])
        with self.assertRaises(ValueError):
            forecast(head(), {**target, 'awayTeamId': 99}, [])

    def test_delayed_original_publication_rebuilds_in_original_start_order(self):
        late = row()
        newer = row(2, start='2023-11-02T00:00:00Z', cutoff='2023-11-01T23:00:00Z', final='2023-11-02T03:00:00Z', home=3, away=1)
        target = row(3, start='2023-11-04T00:00:00Z', cutoff='2023-11-03T23:00:00Z', final='2023-11-04T03:00:00Z')
        late['finalAvailableAt'] = '2023-11-03T22:00:00Z'
        result = forecast(head(), target, [newer, late])
        params = list(head()['parameters'].values())
        expected, _ = dense(params, arrays([late, newer], head()['teams']), head()['teams'], instant(target['startAt']), observation(target, head()['teams']))
        assert_allclose([result['homeCorrection'], result['awayCorrection']], expected, atol=1e-11)
        self.assertEqual(result['observationsUsed'], 2)

    def test_training_selection_never_reads_later_outcomes_features(self):
        train = [row(i+1, season=2022) for i in range(1000)]
        source = {'rows': train+[{'season': 2023, 'homeScore': 'poison'}], 'firstSelection': '2023-11-01T00:00:00Z',
                  'trainingRows': 1000, 'trainingBaselineHash': 'b'*64}
        # Supply genuinely prior training clocks for this synthetic selection test.
        for r in train:
            r['baselineTrainingEnd'] = '2021-01-01T00:00:00Z'
        source['firstSelection'] = '2024-01-01T00:00:00Z'
        first = training_rows(source)
        source['rows'][-1] = {'season': 2025, 'homeScore': object()}
        self.assertEqual(first, training_rows(source))


if __name__ == '__main__':
    unittest.main()
