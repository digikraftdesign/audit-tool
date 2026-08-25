<?php

declare(strict_types=1);

namespace DK\Audit;

/**
 * Weighted parameter scoring.
 *
 * Each parameter is marked out of 10 — starting at 10 and losing points per
 * finding by severity — then weighted into a score out of 100. A parameter the
 * analyser could not measure stays null and is excluded from the maths until a
 * human sets it, and the score is labelled provisional while that is true.
 */
final class Scorer
{
    /**
     * @param  array<int,array<string,mixed>> $findings
     * @param  array<string,string>           $coverage  parameter => 'auto'|'manual'
     * @param  array<string,int>              $manual    parameter => 0-10 set by the consultant
     * @return array<string,mixed>
     */
    public static function score(string $type, array $findings, array $coverage, array $manual = []): array
    {
        $definitions = Types::parameters($type);
        $counts      = ['high' => 0, 'medium' => 0, 'low' => 0];
        $rows        = [];

        foreach ($definitions as $id => $def) {
            $rows[$id] = [
                'id'       => $id,
                'label'    => $def['label'],
                'blurb'    => $def['blurb'],
                'weight'   => (int) $def['weight'],
                'score'    => 10.0,
                'source'   => $coverage[$id] ?? 'auto',
                'findings' => 0,
                'high'     => 0,
                'points'   => 0.0,
            ];
        }

        foreach ($findings as $f) {
            $p = (string) ($f['parameter'] ?? '');
            if (!isset($rows[$p])) {
                continue;
            }
            $sev = (string) $f['severity'];
            $counts[$sev] = ($counts[$sev] ?? 0) + 1;
            $rows[$p]['findings']++;
            if ($sev === 'high') {
                $rows[$p]['high']++;
            }
            $rows[$p]['score'] -= Rules::WEIGHT[$sev] ?? 1;
        }

        $scoredWeight = 0;
        $earned       = 0.0;
        $unscored     = [];

        foreach ($rows as $id => $row) {
            $score = max(0.0, min(10.0, $row['score']));

            if (array_key_exists($id, $manual) && $manual[$id] !== null && $manual[$id] !== '') {
                $score           = max(0, min(10, (int) $manual[$id]));
                $rows[$id]['source'] = 'manual';
            } elseif ($row['source'] === 'manual') {
                // Nothing measurable and nobody has scored it yet.
                $rows[$id]['score']  = null;
                $rows[$id]['points'] = null;
                $unscored[]          = $id;
                continue;
            }

            $rows[$id]['score']  = round($score, 1);
            $rows[$id]['points'] = round($score / 10 * $row['weight'], 1);
            $scoredWeight       += $row['weight'];
            $earned             += $score / 10 * $row['weight'];
        }

        $overall = $scoredWeight > 0 ? (int) round($earned / $scoredWeight * 100) : 0;

        return [
            'overall'       => $overall,
            'provisional'   => $unscored !== [],
            'unscored'      => $unscored,
            'scored_weight' => $scoredWeight,
            'parameters'    => $rows,
            'counts'        => $counts,
            'grade'         => Types::grade($overall),
        ];
    }

    /**
     * Distinct pieces of work the findings imply, in calendar order.
     *
     * @param  array<int,array<string,mixed>> $findings
     * @return array<int,array{service:string,month:string,months:array<int,int>,findings:int}>
     */
    public static function workOrders(array $findings): array
    {
        $orders = [];
        foreach ($findings as $f) {
            $key = (string) $f['service'];
            if (!isset($orders[$key])) {
                $orders[$key] = ['service' => $key, 'month' => $f['month'], 'months' => [], 'findings' => 0];
            }
            $orders[$key]['findings']++;
            foreach (self::monthNumbers((string) $f['month']) as $m) {
                $orders[$key]['months'][$m] = $m;
            }
        }

        foreach ($orders as $key => $o) {
            $months = array_values($o['months']);
            sort($months);
            $orders[$key]['months'] = $months;
            $orders[$key]['month']  = self::monthLabel($months);
        }

        $out = array_values($orders);
        usort($out, static function ($a, $b) {
            $cmp = ($a['months'][0] ?? 9) <=> ($b['months'][0] ?? 9);
            return $cmp !== 0 ? $cmp : $b['findings'] <=> $a['findings'];
        });

        return $out;
    }

    /** "Month 1–2" => [1,2] */
    public static function monthNumbers(string $label): array
    {
        preg_match_all('/\d/', $label, $m);
        $nums = array_map('intval', $m[0]);
        if (count($nums) === 2 && $nums[1] > $nums[0]) {
            return range($nums[0], $nums[1]);
        }
        return $nums ?: [1];
    }

    /** @param array<int,int> $months */
    public static function monthLabel(array $months): string
    {
        if (!$months) {
            return 'Month 1';
        }
        $min = min($months);
        $max = max($months);
        return $min === $max ? 'Month ' . $min : 'Month ' . $min . '–' . $max;
    }
}
